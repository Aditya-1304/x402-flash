import pino from "pino";
import config from "config";

const logLevel = config.get<string>("logLevel");

const redactPaths = [
  'rpcUrl',
  'apiKey',
  'api-key',
  'HELIUS_API_KEY',
  'ATXP_CONNECTION',
  'VISA_TAP_JWT_SECRET',
  'jwt',
  'token',
  'secret',
  'password',
  'key'
];

export const logger = pino({
  level: logLevel,
  redact: {
    paths: redactPaths,
    censor: '[REDACTED]'
  },
  transport: {
    target: "pino-pretty",
    options: {
      colorize: true,
      ignore: "pid,hostname",
      translateTime: "HH:MM:ss Z",
    },
  },
});