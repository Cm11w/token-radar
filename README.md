# Token Radar — a token launch radar

A ranked board of every pre-token protocol in a frozen DefiLlama snapshot,
scored by an implied value computed from each protocol's own figures, with a
farm plan for each one. Built for make.fun's `token-radar-01` bounty.

## The model

```
implied value = TVL × market multiple × growth × maturity × breadth
```

The **market multiple** is measured from the snapshot itself: the median
market-cap-to-TVL ratio of the snapshot's trading tokens — per category where
at least 4 trading tokens exist, else the global median. Growth is the 7-day
TVL change, clamped. Maturity rewards time running with no token. Breadth
rewards distribution across chains. One function scores every protocol; no
name is special-cased. The dashboard states the model, shows every factor per
protocol, and lets the reader re-run it with different constants.

## Layout

```
main.ts               the entrypoint: snapshot in, board.json + data.js + dossier out
lib/model.ts          the model, the farm plans, the board builder, the checks
vendor/               make.fun's dossier library, byte for byte
dashboard/            index.html + app.css + app.js (no network, no framework)
screenshots/          the board, a detail view, a filtered view
```

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Then serve `out/` with any static file server and open `dashboard/index.html`.
The page reads `../data.js`, which the program writes from the same board.

## License

MIT — see LICENSE.
