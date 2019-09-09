import test from "ava";
import { expect } from "chai";
const { demux, map } = require("../src");
import { Writable } from "stream";
const sinon = require("sinon");
const { sleep } = require("../src/helpers");
import { performance } from "perf_hooks";

interface Test {
    key: string;
    visited: number[];
}
test.cb("demux() constructor should be called once per key", t => {
    t.plan(1);
    const input = [
        { key: "a", visited: [] },
        { key: "b", visited: [] },
        { key: "a", visited: [] },
        { key: "c", visited: [] },
    ];
    const construct = sinon.spy((destKey: string) => {
        const dest = map((chunk: Test) => {
            chunk.visited.push(1);
            return chunk;
        });

        return dest;
    });

    const demuxed = demux(construct, { key: "key" }, { objectMode: true });

    demuxed.on("finish", () => {
        expect(construct.withArgs("a").callCount).to.equal(1);
        expect(construct.withArgs("b").callCount).to.equal(1);
        expect(construct.withArgs("c").callCount).to.equal(1);
        t.pass();
        t.end();
    });

    input.forEach(event => demuxed.write(event));
    demuxed.end();
});

test.cb("demux() constructor should be called once per key using keyBy", t => {
    t.plan(1);
    const input = [
        { key: "a", visited: [] },
        { key: "b", visited: [] },
        { key: "a", visited: [] },
        { key: "c", visited: [] },
    ];

    const construct = sinon.spy((destKey: string) => {
        const dest = map((chunk: Test) => {
            chunk.visited.push(1);
            return chunk;
        });

        return dest;
    });

    const demuxed = demux(
        construct,
        { keyBy: item => item.key },
        { objectMode: true },
    );

    demuxed.on("finish", () => {
        expect(construct.withArgs("a").callCount).to.equal(1);
        expect(construct.withArgs("b").callCount).to.equal(1);
        expect(construct.withArgs("c").callCount).to.equal(1);
        t.pass();
        t.end();
    });

    input.forEach(event => demuxed.write(event));
    demuxed.end();
});

test.cb("should emit errors", t => {
    t.plan(2);
    let index = 0;
    const input = [
        { key: "a", visited: [] },
        { key: "b", visited: [] },
        { key: "a", visited: [] },
        { key: "a", visited: [] },
    ];
    const results = [
        { key: "a", visited: [0] },
        { key: "b", visited: [1] },
        { key: "a", visited: [2] },
        { key: "a", visited: [3] },
    ];
    const destinationStreamKeys = [];
    const sink = new Writable({
        objectMode: true,
        write(chunk, enc, cb) {
            expect(results).to.deep.include(chunk);
            expect(input).to.not.deep.include(chunk);
            t.pass();
            cb();
        },
    });

    const construct = (destKey: string) => {
        destinationStreamKeys.push(destKey);
        const dest = map((chunk: Test) => {
            if (chunk.key === "b") {
                throw new Error("Caught object with key 'b'");
            }

            const _chunk = { ...chunk, visited: [] };
            _chunk.visited.push(index);
            index++;
            return _chunk;
        }).on("error", () => {});

        dest.pipe(sink);
        return dest;
    };

    const demuxed = demux(
        construct,
        { keyBy: (chunk: any) => chunk.key },
        { objectMode: true },
    );
    demuxed.on("error", e => {
        expect(e.message).to.equal("Caught object with key 'b'");
        t.pass();
        t.end();
    });
    input.forEach(event => demuxed.write(event));
    demuxed.end();
});

test("compose() should emit drain event ~rate * highWaterMark ms for every write that causes backpressure", async t => {
    t.plan(7);
    const highWaterMark = 5;
    const _rate = 25;
    return new Promise(async (resolve, reject) => {
        interface Chunk {
            key: string;
            mapped: number[];
        }
        const sink = new Writable({
            objectMode: true,
            write(chunk, encoding, cb) {
                cb();
                t.pass();
                pendingReads--;
                if (pendingReads === 0) {
                    resolve();
                }
            },
        });
        const construct = (destKey: string) => {
            const first = map(async (chunk: Chunk) => {
                await sleep(_rate);
                chunk.mapped.push(1);
                return chunk;
            });

            const second = map(async (chunk: Chunk) => {
                chunk.mapped.push(2);
                return chunk;
            });

            first.pipe(second).pipe(sink);
            return first;
        };
        const _demux = demux(
            construct,
            { key: "key" },
            {
                objectMode: true,
                highWaterMark,
            },
        );
        _demux.on("error", err => {
            reject();
        });

        _demux.on("drain", () => {
            expect(_demux._writableState.length).to.be.equal(0);
            expect(performance.now() - start).to.be.greaterThan(_rate);
            t.pass();
        });

        const input = [
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
        ];
        let pendingReads = input.length;

        let start = performance.now();
        for (const item of input) {
            const res = _demux.write(item);
            expect(_demux._writableState.length).to.be.at.most(highWaterMark);
            if (!res) {
                start = performance.now();
                await sleep(100);
            }
        }
    });
});

test("demux() should emit one drain event when writing 6 items with highWaterMark of 5", t => {
    t.plan(7);
    const highWaterMark = 5;
    return new Promise(async (resolve, reject) => {
        interface Chunk {
            key: string;
            mapped: number[];
        }
        const sink = new Writable({
            objectMode: true,
            write(chunk, encoding, cb) {
                cb();
                t.pass();
                if (chunk.key === "f") {
                    resolve();
                }
            },
        });
        const construct = (destKey: string) => {
            const first = map(async (chunk: Chunk) => {
                chunk.mapped.push(1);
                return chunk;
            });

            const second = map(async (chunk: Chunk) => {
                chunk.mapped.push(2);
                return chunk;
            });

            first.pipe(second).pipe(sink);
            return first;
        };
        const _demux = demux(
            construct,
            { key: "key" },
            {
                objectMode: true,
                highWaterMark,
            },
        );
        _demux.on("error", err => {
            reject();
        });

        _demux.on("drain", () => {
            expect(_demux._writableState.length).to.be.equal(0);
            t.pass();
        });

        const input = [
            { key: "a", mapped: [] },
            { key: "b", mapped: [] },
            { key: "c", mapped: [] },
            { key: "d", mapped: [] },
            { key: "e", mapped: [] },
            { key: "f", mapped: [] },
        ];

        for (const item of input) {
            const res = _demux.write(item);
            expect(_demux._writableState.length).to.be.at.most(highWaterMark);
            if (!res) {
                await sleep(10);
            }
        }
    });
});

test.cb(
    "demux() should emit drain event after 500 ms when writing 5 items that take 100ms to process with a highWaterMark of 5 ",
    t => {
        t.plan(6);
        const _rate = 100;
        const highWaterMark = 5;
        interface Chunk {
            key: string;
            mapped: number[];
        }
        const sink = new Writable({
            objectMode: true,
            write(chunk, encoding, cb) {
                t.pass();
                cb();
                if (pendingReads === 0) {
                    t.end();
                }
            },
        });
        const construct = (destKey: string) => {
            const first = map(
                async (chunk: Chunk) => {
                    chunk.mapped.push(1);
                    await sleep(_rate);
                    return chunk;
                },
                { objectMode: true },
            );

            const second = map(
                (chunk: Chunk) => {
                    pendingReads--;
                    chunk.mapped.push(2);
                    return chunk;
                },
                { objectMode: true, highWaterMark: 1 },
            );

            first.pipe(second).pipe(sink);
            return first;
        };
        const _demux = demux(
            construct,
            { key: "key" },
            {
                objectMode: true,
                highWaterMark,
            },
        );
        _demux.on("error", err => {
            t.end(err);
        });

        _demux.on("drain", () => {
            expect(_demux._writableState.length).to.be.equal(0);
            expect(performance.now() - start).to.be.greaterThan(
                _rate * input.length,
            );
            t.pass();
        });

        const input = [
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
        ];

        let pendingReads = input.length;
        input.forEach(item => {
            _demux.write(item);
        });
        const start = performance.now();
    },
);
test.cb(
    "demux() should emit drain event immediately when second stream is bottleneck",
    t => {
        t.plan(6);
        const highWaterMark = 5;
        interface Chunk {
            key: string;
            mapped: number[];
        }
        const sink = new Writable({
            objectMode: true,
            write(chunk, encoding, cb) {
                t.pass();
                cb();
                if (pendingReads === 0) {
                    t.end();
                }
            },
        });
        const construct = (destKey: string) => {
            const first = map(
                (chunk: Chunk) => {
                    chunk.mapped.push(1);
                    return chunk;
                },
                { objectMode: true },
            );

            const second = map(
                async (chunk: Chunk) => {
                    pendingReads--;
                    await sleep(200);
                    chunk.mapped.push(2);
                    expect(second._writableState.length).to.be.equal(1);
                    expect(first._readableState.length).to.equal(pendingReads);
                    return chunk;
                },
                { objectMode: true, highWaterMark: 1 },
            );

            first.pipe(second).pipe(sink);
            return first;
        };
        const _demux = demux(
            construct,
            { key: "key" },
            {
                objectMode: true,
                highWaterMark,
            },
        );
        _demux.on("error", err => {
            t.end(err);
        });

        _demux.on("drain", () => {
            expect(_demux._writableState.length).to.be.equal(0);
            expect(performance.now() - start).to.be.lessThan(50);
            t.pass();
        });

        const input = [
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
        ];

        let pendingReads = input.length;
        input.forEach(item => {
            _demux.write(item);
        });
        const start = performance.now();
    },
);

test("demux() should emit drain event and first should contain up to highWaterMark items in readable state when second is bottleneck", t => {
    t.plan(6);
    const highWaterMark = 5;
    return new Promise(async (resolve, reject) => {
        interface Chunk {
            key: string;
            mapped: number[];
        }
        const sink = new Writable({
            objectMode: true,
            write(chunk, encoding, cb) {
                t.pass();
                cb();
                if (pendingReads === 0) {
                    resolve();
                }
            },
        });
        const construct = (destKey: string) => {
            const first = map(
                (chunk: Chunk) => {
                    expect(first._readableState.length).to.be.at.most(2);
                    chunk.mapped.push(1);
                    return chunk;
                },
                { objectMode: 2, highWaterMark: 2 },
            );

            const second = map(
                async (chunk: Chunk) => {
                    chunk.mapped.push(2);
                    expect(second._writableState.length).to.be.equal(1);
                    await sleep(100);
                    pendingReads--;
                    return chunk;
                },
                { objectMode: 2, highWaterMark: 2 },
            );

            first.pipe(second).pipe(sink);
            return first;
        };
        const _demux = demux(
            construct,
            { key: "key" },
            {
                objectMode: true,
                highWaterMark,
            },
        );
        _demux.on("error", err => {
            reject();
        });

        _demux.on("drain", () => {
            expect(_demux._writableState.length).to.be.equal(0);
            t.pass();
        });

        const input = [
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
            { key: "a", mapped: [] },
        ];
        let pendingReads = input.length;

        input.forEach(item => {
            _demux.write(item);
        });
    });
});
