/* Dedicated WebLLM worker: the calculator UI remains responsive during inference. */
import { WebWorkerMLCEngineHandler } from 'https://esm.run/@mlc-ai/web-llm@0.2.89';
const handler = new WebWorkerMLCEngineHandler();
self.onmessage = (message) => handler.onmessage(message);
