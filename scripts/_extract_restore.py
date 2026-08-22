#!/usr/bin/env python3
"""Extract the restore SQL from ezfd-admin.sh for scripts/test-restore.sh.

Taking the SQL from the shipped script rather than copying it means the test
cannot quietly drift away from the code it covers.

The single substitution is the input mechanism: ezfd-admin.sh reads the backup
with pg_read_file(), which reads the *server's* filesystem. That is right in
production, where the admin script runs on the database host, but in CI the
database is a container that cannot see the runner's filesystem. The file read
is therefore replaced with the JSON inlined as a dollar-quoted literal, so the
~80 lines of parsing and insert logic after it are exercised verbatim.
"""
import sys

src, json_file, out = sys.argv[1], sys.argv[2], sys.argv[3]

s = open(src).read()
start = s.index('    DO \\$\\$')
end = s.index('SELECT orig_code, new_code, qso_count FROM _restore_summary;')
block = s[start:end].replace('\\$\\$', '$$')

payload = open(json_file).read().strip()

# Dollar quoting avoids escaping anything inside the JSON. The tag is specific
# enough that it cannot occur in a callsign, club name, note or QSL string.
TAG = '$ezfdjson$'
if TAG in payload:
    sys.exit('backup JSON unexpectedly contains the dollar-quote tag')

# The literal text as it appears in ezfd-admin.sh, where the path is still
# the unexpanded shell variable.
needle = "pg_read_file('$json_file')"
if needle not in block:
    sys.exit('could not find the pg_read_file call to substitute')
block = block.replace(needle, '%s%s%s' % (TAG, payload, TAG))

open(out, 'w').write(
    'CREATE TEMP TABLE _restore_summary(orig_code text, new_code text, qso_count int);\n'
    + block + '\nSELECT new_code FROM _restore_summary;\n')
