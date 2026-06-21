const http = require("http");
const { Worker, parentPort, workerData } = require("worker_threads");
const path = require("path");
const fs = require("fs");
const { MockSensor } = require("./mock-sensor");

const configPath = path.join(__dirname, "config.json");
const config = JSON.parse(fs.readFileSync(configPath, "utf-8"));

const stats = {
  messagesSent: 0,
  messagesReceived: 0,
  errors: 0,
  connections: 0,
  dropouts: 0,
  reconnections: 0,
  latencies: [],
  recordLatency(ms) {
    this.latencies.push(ms);
  },
  reset() {
    this.messagesSent = 0;
    this.messagesReceived = 0;
    this.errors = 0;
    this.connections = 0;
    this.dropouts = 0;
    this.reconnections = 0;
    this.latencies = [];
  },
};

function computePercentiles(sorted, p) {
  if (sorted.length === 0) return 0;
  const index = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
}

function printReport(stats, durationMs, sensorCount) {
  const durationSec = durationMs / 1000;
  const sorted = [...stats.latencies].sort((a, b) => a - b);

  console.log("\n=== Load Test Report ===");
  console.log(`Duration: ${durationSec.toFixed(1)}s`);
  console.log(`Sensors: ${sensorCount}`);
  console.log(`Messages Sent: ${stats.messagesSent}`);
  console.log(`Messages Received: ${stats.messagesReceived}`);
  console.log(`Throughput: ${(stats.messagesReceived / durationSec).toFixed(1)} msg/s`);
  console.log(`Error Rate: ${((stats.errors / Math.max(stats.messagesSent, 1)) * 100).toFixed(2)}%`);
  console.log(`Connections: ${stats.connections}`);
  console.log(`Dropouts: ${stats.dropouts}`);
  console.log(`Reconnections: ${stats.reconnections}`);
  console.log(`\nLatency (ms):`);
  console.log(`  P50: ${computePercentiles(sorted, 50).toFixed(1)}`);
  console.log(`  P95: ${computePercentiles(sorted, 95).toFixed(1)}`);
  console.log(`  P99: ${computePercentiles(sorted, 99).toFixed(1)}`);
  console.log(`  Min: ${sorted[0]?.toFixed(1) ?? "N/A"}`);
  console.log(`  Max: ${sorted[sorted.length - 1]?.toFixed(1) ?? "N/A"}`);

  return stats.errors === 0;
}

function runWorkerSimulation(sensorCount, durationMs) {
  return new Promise((resolve) => {
    const sensors = [];
    for (let i = 0; i < sensorCount; i++) {
      const sensor = new MockSensor(config, stats);
      sensors.push(sensor);
    }

    console.log(`Starting ${sensorCount} mock sensors for ${(durationMs / 1000).toFixed(0)}s...`);

    const promises = sensors.map((s) => s.run().catch(() => {}));

    const timer = setTimeout(() => {
      sensors.forEach((s) => s.stop());
      Promise.allSettled(promises).then(() => {
        const endTime = Date.now();
        resolve(endTime);
      });
    }, durationMs);

    if (timer.unref) timer.unref();
  });
}

async function main() {
  const args = process.argv.slice(2);
  const ciMode = args.includes("--ci");

  const sensorCount = ciMode
    ? config.simulation.ciSensorCount
    : config.simulation.sensorCount;
  const durationMs = ciMode
    ? config.simulation.ciTestDurationMs
    : config.simulation.testDurationMs;

  console.log(`AgriTrust Load Test (${ciMode ? "CI" : "full"} mode)`);
  console.log(`Target: http://${config.target.host}:${config.target.port}${config.target.endpoint}`);

  const workerCount = config.workers;
  const sensorsPerWorker = Math.ceil(sensorCount / workerCount);

  if (!ciMode && workerCount > 1) {
    const workers = [];
    let completed = 0;

    for (let i = 0; i < workerCount; i++) {
      const count = i === workerCount - 1
        ? sensorCount - i * sensorsPerWorker
        : sensorsPerWorker;

      const w = new Worker(__filename, {
        workerData: {
          sensorCount: count,
          durationMs,
          workerId: i,
        },
      });

      w.on("message", (msg) => {
        if (msg.type === "done") {
          stats.messagesSent += msg.stats.messagesSent;
          stats.messagesReceived += msg.stats.messagesReceived;
          stats.errors += msg.stats.errors;
          stats.connections += msg.stats.connections;
          stats.dropouts += msg.stats.dropouts;
          stats.reconnections += msg.stats.reconnections;
          stats.latencies.push(...msg.stats.latencies);
          completed++;
          if (completed === workerCount) {
            printReport(stats, durationMs, sensorCount);
            process.exit(0);
          }
        }
      });

      w.on("error", (err) => {
        console.error(`Worker ${i} error:`, err);
        completed++;
      });

      workers.push(w);
    }
  } else {
    const startTime = Date.now();
    await runWorkerSimulation(sensorCount, durationMs);
    const endTime = Date.now();
    printReport(stats, endTime - startTime, sensorCount);
  }
}

if (workerData) {
  const { sensorCount, durationMs } = workerData;
  runWorkerSimulation(sensorCount, durationMs).then(() => {
    parentPort.postMessage({
      type: "done",
      stats: {
        messagesSent: stats.messagesSent,
        messagesReceived: stats.messagesReceived,
        errors: stats.errors,
        connections: stats.connections,
        dropouts: stats.dropouts,
        reconnections: stats.reconnections,
        latencies: stats.latencies,
      },
    });
  });
} else {
  main().catch((err) => {
    console.error("Load test failed:", err);
    process.exit(1);
  });
}
