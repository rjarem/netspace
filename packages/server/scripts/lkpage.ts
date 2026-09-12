// Sanity: is the served bundle the same as repo dist?
import { readFileSync } from "fs";
import { createHash } from "crypto";
const local = readFileSync("../client/dist/assets/index-haIqK_UE.js");
console.log("local hash:", createHash("md5").update(local).digest("hex").slice(0,8), "size:", local.length);
