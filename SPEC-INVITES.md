# Trade invites: people the trade went to who aren't on the app yet

When a poster sends a trade to someone with no account, the poster's Trades card offers to text them from the poster's own phone.

## Phase 1 (now)

- **One text per person**, from the poster's phone. It starts "Hi <first name>," (from the staff list), says who wants to trade which day, and ends with the plain app link: "Sign up for Dept Scheduler & Trade Board: <link>". There are no personal links.
- **Messages opens addressed to them** when their cell is on the staff list (`createInvite` returns the cells); otherwise the poster picks them from their contacts. The button reads "Text <first name>" and shows the number first.
- **They answer by texting the poster back.** No sign-up is needed for that. The poster records the answer with **Add their answer**, then picks it like any other answer.
- When they sign up later, they see the board like everyone else.
- On the claude.ai page, where Messages links can't open, each person gets their own copy box.

## Phase 2 (later, not built)

- **A personal link per person.** Tapping it shows the trade and lets them answer in the app before signing up.
- **The answer is held as unconfirmed** until they sign up with their own Employee ID or staff-list cell; then it's recorded as theirs. Someone the link reached by mistake can't confirm it.
- The functions for this already exist and are unused: `inviteInfo`, `answerFromInvite`, `redeemInvite` (`firebase/functions/index.js`) and the link pages in `admin.js`. As built, the link page asks for the Employee ID before it saves an answer; holding it unconfirmed until sign-up would be the change.
- **To decide before building:** whether the poster can pick an unconfirmed answer, and wording that doesn't read as spam (users found the personal links spammy).
