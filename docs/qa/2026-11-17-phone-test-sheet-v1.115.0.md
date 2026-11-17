# Real-phone test sheet — v1.115.0 (Owner · Rider · Order Taker)

**What this is.** Nothing in this release could be tried on a real phone from the build machine — it was tried on the real code in a
browser at phone width, and by tests. This sheet is the short list a person does with the three installed apps in their hand.
Tick each line; write what you saw next to any line that is not right and send the sheet back.

**Before you start.** Install the three APKs from the GitHub Actions run (or the Release page, if a signed build was made — see
`docs/RELEASE-SIGNING.md`). One restaurant that has: a few menu items, one rider, one order-taker account, one owner/manager account,
and — for the website lines — opening hours switched on (Settings → Online Portal → *Opening hours, pause & links*).

Phones tried on: ____________  ·  Android version: ____  ·  Date: ________  ·  Tester: ________

---

## A. All three apps

| # | Do this | You should see | ✔ / ✘ |
|---|---|---|---|
| A1 | Open the app from cold (kill it first) | Its own start screen (Owner / Rider / Order Taker colours), then the sign-in. No white flash, no logo too big | |
| A2 | On the sign-in, switch **English → اردو** | Words turn Urdu, the page flips right-to-left, English names like *DT Rider* stay readable and in one piece | |
| A3 | Switch to **Roman Urdu** | The same words in English letters (“Password bhool gaye?”), the page stays left-to-right, nothing is half Urdu script | |
| A4 | Switch back to **English** | Everything is the original English again | |
| A5 | Sign in, then close and reopen the app | Still signed in; the language you chose is still chosen | |
| A6 | Turn on airplane mode, open a screen you already visited | The screen still shows its last data; a clear “offline” sign, no blank page | |
| A7 | Turn airplane mode off | It catches up by itself within a minute | |
| A8 | Open any pop-up (e.g. a confirmation) | It comes up **from the bottom, fully on screen** (this was a fault in v1.114.0 and earlier on phones: pop-ups sat half off the screen — fixed in v1.115.0) | |
| A9 | Rotate the phone | Nothing is cut off; rotate back | |

## B. DT Rider

| # | Do this | You should see | ✔ / ✘ |
|---|---|---|---|
| B1 | Home tab | Today’s count, **Cash to collect** for the open orders | |
| B2 | Take an order → pick up → deliver it (cash) | Each step moves on one big button; the order appears under History | |
| B3 | Home after delivering | A card **“Cash to hand over”** with the amount and “give it to the cashier” | |
| B4 | Record tab → open the delivered order | A **“Cash taken”** line: “· to hand over” | |
| B5 | At the till (Riders page) press **Receive cash** for this rider | The till shows the amount received | |
| B6 | Back in the Rider app, pull to refresh | The “Cash to hand over” card is gone; the order says “· handed over” | |

## C. DT Order Taker

| # | Do this | You should see | ✔ / ✘ |
|---|---|---|---|
| C1 | Open Tables, pick a table, add three items, send | Order number is the next one — never a number already used | |
| C2 | At the till | The order is there within a few seconds, from the order taker, with the table | |
| C3 | Order Taker → Bills | The order you just sent, correct total | |
| C4 | Take a second order in the other app’s cart | Each app keeps its own cart; one does not fill the other | |
| C5 | Sign in with a wrong password | A clear message on screen (not a blank screen) | |

## D. DT Owner

| # | Do this | You should see | ✔ / ✘ |
|---|---|---|---|
| D1 | Overview | Today’s sales and orders match the till | |
| D2 | Orders → open one | Items, payments, who took it | |
| D3 | More → Website switches | Online ordering, Delivery, Pickup toggles work and the website follows within a minute | |
| D4 | Approve / reject an online order (if any) | The order moves; the customer’s tracking page follows | |
| D5 | Devices | New phones wait for approval; blocking cuts a device off | |

## E. The ordering website (open it in the phone’s browser)

| # | Do this | You should see | ✔ / ✘ |
|---|---|---|---|
| E1 | Open the restaurant’s website link | Header with ☰ menu, search, Delivery / Pickup, hero, one line of categories | |
| E2 | Tap ☰ | Menu · Offers · About us · Help (and My orders when signed in) | |
| E3 | Tap a product’s picture or name | **Product details** from the bottom: size (required), flavour, a note, quantity, big “Add to cart — Rs …” | |
| E4 | Add two of a sized item with a note, open the cart | Quantity 2, the note is on the line, the price is the size’s price | |
| E5 | ☰ → Offers, then back | The cart still has the item (the page is not reloaded) | |
| E6 | Offers → **Copy** on a code, then open the cart | “Code … copied”, and the code is already in the cart’s code box | |
| E7 | ☰ → About us | Name, phone, WhatsApp, address (opens maps), opening hours, branches, social links | |
| E8 | ☰ → Help | WhatsApp and Call tiles, common questions with *this restaurant’s* delivery fee and minimum order | |
| E9 | Set the hours so the restaurant is **closed now** (Settings → Online Portal) and reload the website | An amber banner “We are closed right now. We open … at …”; add buttons greyed out; the cart’s Place Order is greyed out | |
| E10 | While closed, scan a **table QR** code | Ordering still works for the person sitting at the table | |
| E11 | Press **Pause 15 min** in Settings → Online Portal | The website says it is paused; **Resume now** brings it back | |
| E12 | Place a real order with a promo code | The total the server shows may differ from the screen only if the code was not valid; a used-up or account-only code is refused with a clear sentence | |

## F. Result

Overall: ☐ all lines ✔ ☐ some lines ✘ (list the numbers): ______________________________

Anything that felt slow, small, confusing or wrong even where the line is ✔:

______________________________________________________________________________
