// webrtc missing codelab code
// express server with websocket support

import express, { Express } from "express";
import * as http from "http";
import { RawData, WebSocket, WebSocketServer } from "ws";
import * as path from "path";
import * as uuid from "uuid";

import { Result } from "../index";

const port = 3000;
const app: Express = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ noServer: true });
// support upgrading our connection to a websocket connection
server.on("upgrade", (request, socket, head) => {
  wss.handleUpgrade(request, socket, head, (ws) => {
    wss.emit("connection", ws, request);
  });
});

const connections: Map<string, WebSocket> = new Map();

type SigMessage = {
  id: string;
};

function parseWsMessage(data: RawData): Result<SigMessage> {
  let obj = JSON.parse(data.toString());
  if ("id" in obj) {
    return { status: "ok", value: obj };
  }
  console.log(obj);
  return { status: "err", msg: "missing id field" };
}

wss.on("connection", (ws) => {
  const id = uuid.v4();
  console.log(`new connection: ${id}`);
  connections.set(id, ws);
  ws.send(
    JSON.stringify({
      kind: "hello",
      id,
    })
  );

  ws.send(
    JSON.stringify({
      kind: "iceServers",
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
      id,
    })
  );

  ws.on("close", () => {
    console.log("connection closed: ", id);
    connections.delete(id);
  });

  ws.on("message", (msg) => {
    let maybeData = parseWsMessage(msg);
    if (maybeData.status === "err") {
      ws.send(JSON.stringify(maybeData));
      return;
    }
    let data = maybeData.value;
    let peer = connections.get(data.id);
    if (peer === undefined) {
      ws.send(
        JSON.stringify({ status: "err", msg: "no peer with id ${data.id}" })
      );
      return;
    }
    // replace the message ID with _our_ ID and pass it along to the peer
    data.id = id;
    peer.send(JSON.stringify(data), (err) => {
      if (err) {
        console.error("omgomgomg (failed to send to peer)", err);
      }
    });
  });
});

app.use(express.static(path.join(__dirname, "../frontend")));

// using this instead of app.listen so we can support websockets + rest
server.listen(port, () => {
  console.log(`listening on ${port}`);
});
