### **Nesi API**
___
- this is just a private api used for [Card!](https://card.nesiexe.xyz)'s spotify intigration, barq usercount and statuses.
- the routes can be found in api/src/modules

### How to set up:
- run `npm install` and then `task api:up` to start the server, if you want to build the server just run `task api:build`
- for Linting its just `task api:lint` and `task api:lint:fix`

Spotify now playing: `GET /api/now-playing/nesi` or `GET /api/now-playing/frog`.
Set each user's `NESI_SPOTIFY_*` or `FROG_SPOTIFY_*` credentials in `.env`.
Authorize through the private app at `/login?username=nesi` or `/login?username=frog`.
Refresh tokens are persisted to `SPOTIFY_TOKEN_FILE` with `.nesi` or `.frog` appended;
existing single-user installations should move their token file to the `.nesi` path
(or set `NESI_SPOTIFY_REFRESH_TOKEN`). Playback and access-token caches are isolated per user.
