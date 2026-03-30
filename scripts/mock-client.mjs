import { WebSocket } from "ws";

const url = process.env.MOCK_SERVER_URL || "ws://127.0.0.1:8765";
const ws = new WebSocket(url);

ws.on("open", () => {
  ws.send(JSON.stringify({ type: "hello", deviceId: "mock-client", boardType: "mock" }));
  ws.send(JSON.stringify({ type: "ptt_start", ts: Date.now() }));
  ws.send(Buffer.alloc(640, 1));
  setTimeout(() => {
    ws.send(JSON.stringify({ type: "ptt_stop", ts: Date.now() }));
  }, 50);
  setTimeout(() => {
    ws.close();
  }, 500);
});

ws.on("message", (msg) => {
  console.log(msg.toString());
});

ws.on("close", () => {
  process.exit(0);
});

ws.on("error", (error) => {
  console.error(error);
  process.exit(1);
});
