import { Connection } from "@solana/web3.js";
import config from "config";

const rpcUrl = config.get<string>("rpcUrl");

export const connection = new Connection(rpcUrl, "confirmed");
