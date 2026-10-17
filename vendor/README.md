# vendor/

`ws/` is a copy of the [ws](https://github.com/websockets/ws) WebSocket library (MIT license, see `ws/LICENSE`), version recorded in `ws/package.json`.
It is the only runtime dependency of CampusNet. It lives in the repository so that deploying never needs the npm registry or any other
international site (important on hosts that run `npm install` on every start while the international internet may be unreachable).

Update it deliberately: `npm pack ws@<version>`, unpack, replace `vendor/ws/`, run `npm test`. ws works without the optional native add-ons
(`bufferutil`, `utf-8-validate`); they are not needed.
