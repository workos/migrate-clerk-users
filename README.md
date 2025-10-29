# migrate-clerk-users

Tool for importing Clerk users into WorkOS, including setting password hashes.

For more information on migrating from Clerk to WorkOS, refer to [the docs](https://workos.com/docs/migrate/clerk).

## Usage

```bash
WORKOS_SECRET_KEY=sk_test_123 npx github:workos/migrate-clerk-users --help
```

Example output

```
% WORKOS_SECRET_KEY=sk_test_123 npx github:workos/migrate-clerk-users \
  --user-export example-input.json
Need to install the following packages:
  github:workos/migrate-clerk-users
Ok to proceed? (y) y
▶ Importing users from example-input.csv
▶ Processing record #1
✔ Imported record #1
▶ Processing record #2
✔ Imported record #2
┌──────────────────────────────────────┐
│ SUMMARY                              │
│ Status: Success                      │
│ Users imported: 2/2                  │
│ Duration: 842 ms                     │
│ Warnings: 0                          │
│ Errors: 0                            │
└──────────────────────────────────────┘
```

## Input file format

This tool consumes either of the following:

- A JSON export file [obtained from Clerk support by filing a ticket](https://clerk.com/docs/deployments/exporting-users#migrating-your-users-to-a-new-system), which can include hashed passwords. The JSON should be an array of user objects matching the schema in `src/clerk-exported-user.ts`.
- A CSV export from Clerk containing columns: `id,first_name,last_name,username,primary_email_address,primary_phone_number,verified_email_addresses,unverified_email_addresses,verified_phone_numbers,unverified_phone_numbers,totp_secret,password_digest,password_hasher`.

When a `.csv` file is provided, the tool will automatically map Clerk's columns to the expected fields and combine email addresses into the `email_addresses` field (pipe-separated, with the primary email first). No manual transformation is required.

### Passwords

- If `password_digest` is provided with `password_hasher` set to `bcrypt`, the user will be created with that password.
- If a matching user already exists, the importer will update the password hash.

### Email verification behavior

You can control whether to mark the primary email as verified when creating/importing users via the `--email-verified` flag:

- `never` (default): do not mark email as verified.
- `always`: mark the primary email as verified for all users.
- `from-csv`: mark the primary email as verified only if it appears in the CSV column `verified_email_addresses`.

This applies to both newly created users and existing users matched by email. For JSON inputs, `from-csv` behaves like `never` unless you add an optional `primary_email_verified` boolean to the JSON object.

Note that the script will exit with an error if any custom password hashes are present.

### CLI flags

- `--user-export <path>`: Path to Clerk export (JSON array or CSV).
- `--process-multi-email` (default false): If multiple emails exist, use the first; otherwise skip that user.
- `--email-verified <never|always|from-csv>`: Controls whether to mark the primary email as verified.
- `--quiet` (default false): Suppress non-error output.
- `--errors-out <path>`: Write a detailed error report; CSV when `*.csv`, otherwise JSON.

### Error reporting

- Terminal summary shows totals and, if any failures, the first few failed Clerk user ids.
- For a detailed per-record error report, pass `--errors-out path/to/errors.csv` (or `.json`).
  - Report fields: `recordNumber`, `clerkUserId`, `email` (primary), `errorMessage`, `timestamp`.
  - The terminal never prints emails or other PII by default.

### Local testing utilities

- Generate a bcrypt hash (defaults to hashing the string `password`):
  ```bash
  npx tsx bin/gen-bcrypt.ts
  # or specify password and cost: npx tsx bin/gen-bcrypt.ts "mySecret" 12
  ```
  Use the printed hash in the `password_digest` column with `password_hasher=bcrypt`.

## Users with multiple passwords

Clerk's export file returns all email addresses associated with the user under the `email_addresses` field. Unfortunately in the case of multiple email addresses there's no way to know which is the default without querying the Clerk API.

By passing in the `--process-multi-email true` flag to this tool, the first email address in the list will be used as the primary email address when creating the WorkOS user. This applies to both JSON and CSV inputs; for CSV inputs, the primary email is listed first followed by any additional verified and unverified emails.

## Notes

- The CLI respects `NO_COLOR` and non-TTY environments.
- The summary box adapts to terminal width and shows `Users imported: X/Y`.
