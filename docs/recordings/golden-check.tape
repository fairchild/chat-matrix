# The golden check, start to finish, against the live matrix.
#
#   vhs docs/recordings/golden-check.tape        # from the repo root, with scripts/run.sh up
#
# Three beats: every backend green; one backend drifts (a one-word edit to
# cloudflare-agents' scripted model, which wrangler hot-reloads) and the check
# goes red with the diff; the edit is reverted and the check is green again.

Output docs/recordings/golden-check.gif

Set Shell bash
Set FontSize 13
Set Width 1180
Set Height 980
Set Padding 14
Set TypingSpeed 18ms
Set WaitTimeout 3m

Hide
Type "clear"
Enter
Show

Type "# every backend, both protocols, five prompts — against fixtures captured from the reference"
Enter
Type "./scripts/golden.sh"
Enter
Wait
Sleep 4s

Type "clear"
Enter
Type "# a backend drifts: one word in cloudflare-agents' copy of the scripted model"
Enter
Type `sed -i '' "s/Weather(city=/Weather(town=/" backends/cloudflare-agents/src/scripted.ts`
Enter
Sleep 4s
Type "bun protocol/golden.ts http://localhost:8002"
Enter
Wait
Sleep 5s

Type "clear"
Enter
Type "# revert it; green again"
Enter
Type "git checkout -- backends/cloudflare-agents/src/scripted.ts"
Enter
Sleep 4s
Type "bun protocol/golden.ts http://localhost:8002"
Enter
Wait
Sleep 4s
