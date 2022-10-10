interface HasId {
  id: string;
}

export interface Hello extends HasId {
  kind: "hello";
}

export interface IceServers extends HasId {
  kind: "iceServers";
  iceServers: Array<{ urls: string }>;
}

export interface Bye extends HasId {
  kind: "bye";
}

export interface SdpMessage extends HasId {
  kind: "offer" | "answer";
  sdp: string;
}

export interface Candidate extends HasId {
  kind: "candidate";
  candidate: RTCIceCandidate;
}

export type SigMessage = Hello | Bye | IceServers | SdpMessage | Candidate;

type Ok<T> = {
  status: "ok";
  value: T;
};

type Err = {
  status: "err";
  msg: string;
};

export type Result<T> = Ok<T> | Err;
