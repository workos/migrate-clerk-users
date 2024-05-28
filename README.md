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
Importing users from example-input.json
(1) Imported user paul@atreides.com as WorkOS User user_01HCYZ09NQHZ4X1ZRVZ3V09WWW
Multiple email addresses found for user_2gRua7G8WRYBglzXE5sxRbIRkfJ and multi email processing is disabled, skipping.
(2) Could not find or create user user_2gRua7G8WRYBglzXE5sxRbIRkfJ
(3) Imported user vlad@harkonnen.com as WorkOS User user_01HCYZ09PRH8THC7ZEDYBEJ008
Done importing. 4 of 6 user records imported.
```

## Input file format

This tool consumes the export file [obtained from Clerk support by filing a ticket](https://clerk.com/docs/deployments/exporting-users#migrating-your-users-to-a-new-system), which can include hashed passwords.

Note that the script will exit with an error if any custom password hashes are present.

## Users with multiple passwords

Clerk's export file returns all email addresses associated with the user under the `email_addresses` field. Unfortunately in the case of multiple email addresses there's no way to know which is the default without querying the Clerk API.

By passing in the `--process-multi-email true` flag to this tool, the first email address in the list will be used as the primary email address when creating the WorkOS user.
