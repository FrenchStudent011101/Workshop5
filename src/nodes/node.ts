import bodyParser from "body-parser";
import express from "express";
import { BASE_NODE_PORT } from "../config";
import { Value } from "../types";
import { delay } from "../utils";

type NodeState = {
  killed: boolean;
  x: 0 | 1 | "?" | null;
  decided: boolean | null;
  k: number | null;
};

export async function node(
    nodeId: number,
    N: number,
    F: number,
    initialValue: Value,
    isFaulty: boolean,
    nodesOK: () => boolean,
    setNodeIsReady: (index: number) => void
) {
  const app = express();
  app.use(express.json());
  app.use(bodyParser.json());

  let proposalMap: Map<number, Value[]> = new Map();
  let voteMap: Map<number, Value[]> = new Map();

  let currentNodeState: NodeState = {killed: false,x: initialValue,decided: false,k: 0};


  app.get("/status", (req, res) => {
    if (isFaulty) {
      res.status(500).send("faulty");
    } else {
      res.status(200).send("live");
    }
  });

  app.get("/start", async (req, res) => {
    while (!nodesOK()) {
      await delay(100);
    }

    if (!isFaulty) {
      currentNodeState = {
        killed: false,
        x: initialValue,
        decided: false,
        k: 1,
      };

      for (let i = 0; i < N; i++) {
        sendMessage(BASE_NODE_PORT + i, {
          k: currentNodeState.k,
          x: currentNodeState.x,
          type: "2P",
        });
      }
    } else {
      currentNodeState = {
        killed: false,
        x: null,
        decided: null,
        k: null,
      };
    }

    res.status(200).send("success");
  });



  app.post("/message", async (req, res) => {
    const { k: messageK, x: messageX, type: messageType } = req.body;

    if (!currentNodeState.killed && !isFaulty) {
      if (messageType === "2P") {
        handle2PMessage(messageK, messageX);
      } else if (messageType === "2V") {
        handle2VMessage(messageK, messageX);
      }
    }

    res.status(200).send("success");
  });

  app.get("/stop", async (req, res) => {
    currentNodeState.killed = true;
    currentNodeState.x = null;
    currentNodeState.decided = null;
    currentNodeState.k = 0;
    res.send("Node stopped");
  });

  app.get("/getState", (req, res) => {
    if (isFaulty) {
      res.send({
        killed: currentNodeState.killed,
        x: null,
        decided: null,
        k: null,
      });
    } else {
      res.send(currentNodeState);
    }
  });

  const server = app.listen(BASE_NODE_PORT + nodeId, async () => {
    console.log(`Node ${nodeId} is listening on port ${BASE_NODE_PORT + nodeId}`);

    // the node is ready
    setNodeIsReady(nodeId);
  });

  return server;

  function handle2PMessage(messageK: number, messageX: Value) {
    if (!proposalMap.has(messageK)) {
      proposalMap.set(messageK, []);
    }
    proposalMap.get(messageK)!.push(messageX);

    const proposal = proposalMap.get(messageK)!;
    if (proposal.length >= N - F) {
      const CountNeg = proposal.filter((x) => x === 0).length;
      const CountPos = proposal.filter((x) => x === 1).length;
      const newX = CountNeg > N / 2 ? 0 : CountPos > N / 2 ? 1 : "?";

      for (let i = 0; i < N; i++) {
        sendMessage(BASE_NODE_PORT + i, { k: messageK, x: newX, type: "2V" });
      }
    }
  }

  function handle2VMessage(messageK: number, messageX: Value) {
    if (!voteMap.has(messageK)) {
      voteMap.set(messageK, []);
    }
    voteMap.get(messageK)!.push(messageX);

    const vote = voteMap.get(messageK)!;
    if (vote.length >= N - F) {
      const CountNeg = vote.filter((x) => x === 0).length;
      const CountPos = vote.filter((x) => x === 1).length;

      if (CountNeg >= F + 1) {
        currentNodeState.x = 0;
        currentNodeState.decided = true;
      } else if (CountPos >= F + 1) {
        currentNodeState.x = 1;
        currentNodeState.decided = true;
      } else {
        const newX =
            CountNeg + CountPos > 0 && CountNeg > CountPos
                ? 0
                : CountNeg + CountPos > 0 && CountNeg < CountPos
                    ? 1
                    : Math.random() > 0.5
                        ? 0
                        : 1;
        currentNodeState.x = newX;
        currentNodeState.k = messageK + 1;

        for (let i = 0; i < N; i++) {
          sendMessage(BASE_NODE_PORT + i, {
            k: currentNodeState.k,
            x: currentNodeState.x,
            type: "2P",
          });
        }
      }
    }
  }

  function sendMessage(port: number, message: any) {
    fetch(`http://localhost:${port}/message`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(message),
    });
  }
}