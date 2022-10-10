import { Result, SigMessage } from "../index";

const WS_PROTOCOL = window.location.protocol === "https:" ? "wss" : "ws";

class State {
  peers: Map<string, RTCPeerConnection>;
  iceServers: Array<{ urls: string }>;
  id?: string;
  screenShare?: MediaStream;

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

function parseMessage(data: object): Result<SigMessage> {
  console.log(data);
  if (!("id" in data && "kind" in data)) {
    return { status: "err", msg: "missing required field in message" };
  }
  let id = (data as { id: string }).id;
  let kind = (data as { kind: string }).kind;
  console.log(id, kind);
  switch (kind) {
    case "hello":
      return { status: "ok", value: { id, kind } };
    case "bye":
      return { status: "ok", value: { id, kind } };
    case "iceServers":
      console.log("hi", data);
      if ("iceServers" in data) {
        let iceServers = (data as { iceServers: Array<{ urls: string }> })
          .iceServers;
        return { status: "ok", value: { id, kind, iceServers } };
      }
      return {
        status: "err",
        msg: "missing iceServers field for iceServers message",
      };
    case "offer":
      if ("sdp" in data) {
        let sdp = (data as { sdp: string }).sdp;
        return { status: "ok", value: { id, kind, sdp } };
      }
      return { status: "err", msg: "missing sdp field for offer message" };
    case "answer":
      if ("sdp" in data) {
        let sdp = (data as { sdp: string }).sdp;
        return { status: "ok", value: { id, kind, sdp } };
      }
      return { status: "err", msg: "missing sdp field for answer message" };
    case "candidate":
      if ("candidate" in data) {
        let candidate = (data as { candidate: RTCIceCandidate }).candidate;
        return { status: "ok", value: { id, kind, candidate } };
      }
      return {
        status: "err",
        msg: "missing candidate field for candidate message",
      };
    default:
      return { status: "err", msg: "missing required field in message" };
  }
}

async function init() {
  // TODO: check if there's a hash in the URL
  let localStream = await getUserMedia();
  let localVideoEl: HTMLVideoElement = document.getElementById(
    "localVideo"
  ) as HTMLVideoElement;
  localVideoEl.srcObject = localStream;

  const hash = window.location.hash.substring(1);
  getUserMedia()
    .then(connect)
    .then(({ ws, stream }) => {
      if (hash) {
        call(hash, ws, stream);
      }
      setUpHandlers(stream, ws);
      registerEndCall(ws);
    });
}

function registerEndCall(ws: WebSocket) {
  window.addEventListener("beforeunload", () => {
    if (ws.readyState === WebSocket.OPEN) {
      STATE.peers.forEach((_, id) => {
        hangup(id, ws);
      });
    }
  });
}

async function connect(
  localStream: MediaStream
): Promise<{ ws: WebSocket; stream: MediaStream }> {
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
    let maybeData = parseMessage(JSON.parse(msg.data));
    if (maybeData.status === "err") {
      throw new Error(maybeData.msg);
    }
    let data = maybeData.value;
    switch (data.kind) {
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
          type: data.kind,
          sdp: data.sdp,
        });
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        ws.send(
          JSON.stringify({
            kind: "answer",
            sdp: answer.sdp,
            id: data.id,
          })
        );
        break;
      case "answer":
        if (STATE.peers.has(data.id)) {
          const pc = STATE.peers.get(data.id)!;
          await pc.setRemoteDescription({
            type: data.kind,
            sdp: data.sdp,
          });
        } else {
          console.log(`peer not found for answer: ${data.id}`);
        }
        break;
      case "candidate":
        if (STATE.peers.has(data.id)) {
          const pc = STATE.peers.get(data.id)!;
          console.log("addIceCandidate", data);
          await pc.addIceCandidate(data.candidate);
        } else {
          console.log(`peer not found for ice candidate: ${data.id}`);
        }
    }
  });
  return { ws, stream: localStream };
}

function createPeerConnection(
  peerId: string,
  ws: WebSocket
): RTCPeerConnection {
  const pc = new RTCPeerConnection({ iceServers: STATE.iceServers });
  pc.addEventListener("icecandidate", (e) => {
    const { candidate } = e;
    if (candidate === null) {
      return;
    }
    ws.send(JSON.stringify({ kind: "candidate", candidate, id: peerId }));
  });
  pc.addEventListener("track", (e) => {
    const remoteVideo = document.getElementById(
      "remoteVideo"
    )! as HTMLVideoElement;
    remoteVideo.onloadedmetadata = () => {
      console.log(peerId, "loaded metadata");
    };
    remoteVideo.srcObject = e.streams[0];
  });
  pc.addEventListener("iceconnectionstatechange", () => {
    console.log(peerId, "iceconnectionstatechange", pc.connectionState);
  });
  pc.addEventListener("connectionstatechange", () => {
    console.log(peerId, "connectionstatechange", pc.connectionState);
    if (pc.connectionState === "connected") {
      pc.getStats().then(onConnectionStats);
    }
  });
  pc.addEventListener("signalingstatechange", () => {
    console.log(peerId, "signalingstatechange", pc.signalingState);
  });

  STATE.peers.set(peerId, pc);
  return pc;
}

async function queryStats(pc: RTCPeerConnection, lastPeriod: object) {}

function onConnectionStats(stats: RTCStatsReport) {}

// if we tried going to a URL with a peer ID after the hash, then
// let's try to call that peer
async function call(peerId: string, ws: WebSocket, stream: MediaStream) {
  if (STATE.peers.has(peerId)) {
    console.log(`already in a call with peer ${peerId}`);
    return;
  }
  const pc = createPeerConnection(peerId, ws);
  stream.getTracks().forEach((t) => pc.addTrack(t, stream));
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  ws.send(
    JSON.stringify({
      kind: "offer",
      sdp: offer.sdp,
      id: peerId,
    })
  );
  // TODO: set button to disabled and set text of peer id element
}

function hangup(peerId: string, ws: WebSocket) {
  if (!STATE.peers.has(peerId)) {
    console.log(`trying to hang up on non-existent peer: ${peerId}`);
    return;
  }

  const pc = STATE.peers.get(peerId)!;
  pc.close();
  STATE.peers.delete(peerId);
  ws.send(
    JSON.stringify({
      kind: "bye",
      id: STATE.id,
    })
  );
}

function setUpHandlers(stream: MediaStream, ws: WebSocket) {
  const audioEl = document.getElementById("audioBtn")!;
  audioEl.addEventListener("click", () => {
    const audioTrack = stream.getAudioTracks()[0];
    if (audioTrack.enabled) {
      audioEl.classList.add("muted");
    } else {
      audioEl.classList.remove("muted");
    }
    // when enabled is false, we'll still send a small amount of audio data, but mostly silence
    audioTrack.enabled = !audioTrack.enabled;
  });

  const videoEl = document.getElementById("videoBtn")!;
  videoEl.addEventListener("click", () => {
    const videoTrack = stream.getVideoTracks()[0];
    if (videoTrack.enabled) {
      videoEl.classList.add("muted");
    } else {
      videoEl.classList.remove("muted");
    }
    // when enabled is false, most browsers will keep the camera light on
    // from the codelab file:
    // The advanced version of this stops the track to disable and uses
    // replaceTrack to re-enable. Not necessary in Firefox which turns
    // off the camera light.
    videoTrack.enabled = !videoTrack.enabled;
  });

  // screen sharing
  const shareBtn = document.getElementById("shareBtn")!;
  shareBtn.addEventListener("click", async () => {
    if (STATE.screenShare !== undefined) {
      STATE.screenShare.getTracks().forEach((t) => t.stop());
      STATE.screenShare = undefined;
      (document.getElementById("localVideo") as HTMLVideoElement).srcObject =
        stream;
      replaceVideoTrack(stream.getVideoTracks()[0]);
      shareBtn.classList.remove("sharing");
      return;
    }
    const screenStream = await navigator.mediaDevices.getDisplayMedia({
      video: true,
    });
    const track = screenStream.getVideoTracks()[0];
    replaceVideoTrack(track);
    (document.getElementById("localVideo") as HTMLVideoElement).srcObject =
      screenStream;
    track.addEventListener("ended", () => {
      console.log("screenshare ended via browser ui (?)");
      STATE.screenShare = undefined;
      (document.getElementById("localVideo") as HTMLVideoElement).srcObject =
        stream;
      replaceVideoTrack(stream.getVideoTracks()[0]);
      shareBtn.classList.remove("sharing");
    });
    STATE.screenShare = screenStream;
    shareBtn.classList.add("sharing");
  });

  // hanging up
  const hangupBtn = document.getElementById(
    "hangupButton"
  ) as HTMLButtonElement;
  hangupBtn.addEventListener("click", () => {
    hangupBtn.disabled = true;
    STATE.peers.forEach((_, id) => {
      hangup(id, ws);
    });
  });
}

function replaceVideoTrack(newTrack: MediaStreamTrack) {
  STATE.peers.forEach((pc) => {
    const sender = pc
      .getSenders()
      .find((s) => s.track && s.track.kind === "video");
    if (sender) {
      sender.replaceTrack(newTrack);
    }
  });
}

init();
