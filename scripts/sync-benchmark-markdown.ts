import fs from "node:fs";
import { syncBenchmarkDocsMarkdown } from "../benchmarks/run-real-agents.js";

const data = JSON.parse(fs.readFileSync("benchmarks/real-agent-results.json", "utf-8"));
syncBenchmarkDocsMarkdown(data);
console.log("docs/BENCHMARK_RESULTS.md successfully synchronized with latest hardened metrics");
