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
- `GLUCOSE_UNIT`: units to use for glucose values. Can be either `mg/dl` or `mmol/l`. Glucose values will be obtained from diasend with this unit and pushed to nightscout accordingly.

## Running

There are two different ways to use this project in order to synchronize data from diasend to nightscout. You can either [run this bridge standalone](#standalone) in which case it will pull the data via the diasend API and forward it to nightscout via nightscout's REST API. The downside here is that you need to run it on an additional server or PC which is why the more intuitive way is [running the bridge as a plugin directly as part of nightscout](#nightscout-plugin). This way, the data will still be pulled from diasend via its HTTP API but the data will directly be imported into nightscout without going through its REST API, which should likely be more reliable and remove the need to run the bridge separately.

### Nigthscout Plugin

To run this bridge as a plugin directly in nightscout, you can simply install the bridge as an npm package within your nightscout installation and implement a handler to import the data directly into nightscout. A sample implementation can be found here: https://github.com/nightscout/cgm-remote-monitor/compare/master...burnedikt:cgm-remote-monitor:master?expand=1. 

Once installed, the plugin needs to be enabled via nightscout's `ENABLE="... diasend ..."` environment variable and the following two environment variables need to be defined: `DIASEND_USERNAME` and `DIASEND_PASSWORD` so that nightscout will automatically pull data in from diasend.

A future goal is to either merge the example implementation above upstream or publish the bridge as a nightscout plugin directly to npm so that the integration with nightscout becomes easier.

### Standalone

To run the bridge, ensure that all required environment variables are set and simply execute `yarn install` to install all dependencies and then the following command to synchronize CGV from diasend to nightscout every 5 minutes:

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
- [diasend2nightscout-bridge]: Has the same goal of this project but up to now did not provide an end-to-end solution for synchronizing the data between diasend and nightscout as far as I can tell

[diasend]: https://www.diasend.com/
[Share2NightScout Bridge]: https://github.com/nightscout/share2nightscout-bridge
[nightscout]: https://github.com/nightscout/cgm-remote-monitor
[Scott Hanselmann]: https://www.hanselman.com/blog/bridging-dexcom-share-cgm-receivers-and-nightscout
[minimed-connect-to-nightscout]: https://github.com/nightscout/minimed-connect-to-nightscout
[REST Client plugin]: https://marketplace.visualstudio.com/items?itemName=humao.rest-client
[diasend2nightscout-brigde]: https://github.com/funkstille/diasend2nightscout-bridge
