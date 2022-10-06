const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";

class State {
  peers: Map<string, WebSocket>;
  iceServers: Array<{ urls: string }>;
  id?: string;

  constructor() {
    this.peers = new Map();
    this.iceServers = [];
  }

  removePeer(peerId: string): void {
    if (this.peers.has(peerId)) {
      this.peers.get(peerId)?.close();
      this.peers.delete(peerId);
    }
  }
}

const STATE = new State();

async function getUserMedia(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({ audio: true, video: true });
}

async function init() {
  let localStream = await getUserMedia();
  let localVideoEl: HTMLVideoElement = document.getElementById(
    "localVideo"
  ) as HTMLVideoElement;
  localVideoEl.srcObject = localStream;
}

async function connect(localStream: MediaStream): Promise<void> {
  let ws = new WebSocket(`${WS_PROTOCOL}://${window.location.host}`);
  ws.addEventListener("open", () => {
    console.log("websocket, hi!");
  });

  ws.addEventListener("error", (err) => {
    console.log("websocket error: ", err);
    return;
  });

  ws.addEventListener("close", (err) => {
    console.log("websocket closed: ", err);
  });

  ws.addEventListener("message", async (msg) => {
    let data = JSON.parse(msg.data);
    switch (data.type) {
      case "hello":
        STATE.id = data.id;
        let maybeIdEl = document.getElementById("clientId");
        if (maybeIdEl === null) {
          throw new Error("no client id element?");
        }
        maybeIdEl.innerText = data.id;
        break;
      case "iceServers":
        STATE.iceServers = data.iceServers;
        break;
      case "bye":
        STATE.removePeer(data.id);
        break;
      case "offer":
        console.log(`incoming call from ${data.id}`);
        if (STATE.peers.has(data.id)) {
          console.log("hey we've already seen this peer id");
          return;
        }
        if (STATE.peers.size >= 1) {
          console.log("we're busy, actually");
          ws.send(
            JSON.stringify({
              type: "bye",
              id: data.id,
            })
          );
          return;
        }
        let peerEl = document.getElementById("peerId")!;
        peerEl.innerText = data.id;
        // start call
        const pc = createPeerConnection(data.id, ws);
        localStream.getTracks().forEach((t) => pc.addTrack(t, localStream));
        await pc.setRemoteDescription({
          type: data.type,
          sdp: data.sdp,
        });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(JSON.stringify({
          type: 'answer',
          sdp: answer.sdp,
          id: data.id,
        }));
    }
  });
}

function createPeerConnection(
  peerId: string,
  ws: WebSocket
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: STATE.iceServers });
  pc.addEventListener("icecandidate", (e) => {
    const { candidate } = e;
    ws.send(JSON.stringify({ type: "candidate", candidate, id: STATE.id }));
  });
  return pc;
}
