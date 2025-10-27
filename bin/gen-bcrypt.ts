#!/usr/bin/env tsx
import bcrypt from "bcryptjs";

async function main() {
  const plaintext = process.argv[2] ?? "password";
  const rounds = Number(process.argv[3] ?? 10);
  const salt = bcrypt.genSaltSync(rounds);
  const hash = bcrypt.hashSync(plaintext, salt);
  console.log(hash);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
