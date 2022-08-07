# Diasend -> Nightscout Bridge

Synchronizes continuuous glucose values (CGV) from [diasend] to [nightscout]

## Configuration

The following environment variables are required, also see [example.env](./.env.example):

- `DIASEND_USERNAME`: the username / email address of your disasend account
- `DIASEND_PASSWORD`: the password of your disasend account
- `NIGHTSCOUT_URL`: the url of your nightscout instance
- `NIGHTSCOUT_API_SECRET`: the api secret to communicate with your nightscout instance

Optionally, you can also provide the following values:

- `DIASEND_CLIENT_ID`: client id for authorization against diasend. Defaults to `a486o3nvdu88cg0sos4cw8cccc0o0cg.api.diasend.com`
- `DIASEND_CLIENT_SECRET`: client secret for authorization against diasend. Defaults to `8imoieg4pyos04s44okoooowkogsco4`

## Running

To run the bridge, simply execute `yarn install` to install all dependencies and then the following command to synchronize CGV from diasend to nightscout every 5 minutes:

```sh
yarn start
```

## Further information

This project works by connecting to **diasend's internal (!) API, which may change at any time without warning, so use with caution**, and pulling the latest number of
so-called _patient data_, converts it to CGV values compatible with nightscout and then uses the nightscout API to push those values.

More information and sample calls on the diasend-api can be found in [diasend-api.http](./diasend-api.http) which can be used with VSCode's [REST Client plugin]
to quickly try out the API calls.

This project is written in Typescript.

## Related Projects

- [Share2NightScout Bridge]: Similarly to us pulling data from diasend and sending it to nightscout, this projects pulls the data from dexcom web service and pushes it to nightscout. Initially created by [Scott Hanselmann]
- [minimed-connect-to-nightscout]: Scrapes the Minimed website instead of using an API but the bottom line is the same: Pulls data from minimed and pushes it to nightscout

[diasend]: https://www.diasend.com/
[Share2NightScout Bridge]: https://github.com/nightscout/share2nightscout-bridge
[nightscout]: https://github.com/nightscout/cgm-remote-monitor
[Scott Hanselmann]: https://www.hanselman.com/blog/bridging-dexcom-share-cgm-receivers-and-nightscout
[minimed-connect-to-nightscout]: https://github.com/nightscout/minimed-connect-to-nightscout
[REST Client plugin]: https://marketplace.visualstudio.com/items?itemName=humao.rest-client
