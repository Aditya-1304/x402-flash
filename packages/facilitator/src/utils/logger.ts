import pino from "pino";
import config from "config";

const logLevel = config.get<string>("logLevel");

export const logger = pino({
  level: logLevel,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
    },
  },
});