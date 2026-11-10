# Racvest WebSocket test pages

Static pages for testing the Racvest realtime service by hand over STOMP (SockJS).
Open `index.html` for the list of pages and the test flows.

| Page | Who |
| --- | --- |
| `delivery-flow.html` | Courier (left) and sender (right): one delivery from request to drop-off |
| `chat.html` | Courier (left) and sender (right): chat between them |
| `courier-new-delivery-requests.html` | Courier: new delivery requests (DELIVERY_LIVE) |
| `courier-all-events.html` | Courier: every event on `/topic/courier/{id}` |
| `courier-publish-location.html` | Courier: heartbeats and live delivery locations from a map |
| `sender-delivery-request-events.html` | Sender: bids, viewers, auto-accept, tracking, sender events |
| `sender-track-delivery.html` | Sender: the courier moving on a map, ETA and status |
| `sender-nearby-couriers.html` | Sender: nearby couriers around the sender's location |

## Running

- Locally: open `index.html` in a browser, or run any static server in this folder.
- Netlify: connect this repo; there is no build step (`netlify.toml` publishes the root).

Each page connects to the realtime service URL you type (for example `https://<realtime host>` or
`http://localhost:8090`) with a Racvest access token. The URL, tokens and IDs you type are only saved in
your own browser (localStorage) and shared between pages. Use **Clear saved settings** to remove them.
