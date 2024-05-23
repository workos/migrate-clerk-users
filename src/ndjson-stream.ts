import fs from 'fs';
import { JSONParser } from '@streamparser/json';
import { PassThrough } from 'stream';

export async function* ndjsonStream(filePath: string): AsyncIterable<unknown> {
  const fileStream = fs.createReadStream(filePath, { encoding: 'utf8' });
  const jsonParser = new JSONParser();

  // Create a PassThrough stream to pipe data through the parser
  const passThrough = new PassThrough();

  // Create a queue to store the parsed values
  const queue: unknown[] = [];

  let deferredResolve: ((value?: unknown) => void) | null = null;
  const streamComplete = new Promise((resolve, reject) => {
    deferredResolve = resolve;
    fileStream.on('error', reject);
    passThrough.on('error', reject);
  });

  // Handle parsed data
  jsonParser.onValue = ({ value, parent, key }) => {
    if (!Number.isNaN(parseInt(key as string, 10))) {
      queue.push(value);
      if (deferredResolve) {
        deferredResolve();
        deferredResolve = null;
      }
    }
  };

  // Pipe the JSON file stream to the PassThrough stream
  fileStream.pipe(passThrough);

  // Pipe the PassThrough stream to the JSON parser
  passThrough.on('data', (chunk) => {
    jsonParser.write(chunk);
  });

  // Yield parsed objects one by one
  while (true) {
    if (queue.length > 0) {
      yield queue.shift();
    } else if (deferredResolve === null) {
      // No more data to yield
      break;
    } else {
      await new Promise((resolve) => {
        deferredResolve = resolve;
      });
    }
  }
}
