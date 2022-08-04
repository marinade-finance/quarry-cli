import { setup } from "./setup";

setup().parseAsync(process.argv).then(
  () => {},
  (err: unknown) => {
    throw err;
  }
);
