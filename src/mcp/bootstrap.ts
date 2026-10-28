import dotenv from "dotenv";
import path from "path";

console.log = (...args: unknown[]) => console.error(...args);
console.info = (...args: unknown[]) => console.error(...args);
console.debug = (...args: unknown[]) => console.error(...args);

dotenv.config({ path: path.resolve(__dirname, "..", "..", ".env") });