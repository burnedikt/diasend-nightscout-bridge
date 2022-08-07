export default {
  diasend: {
    clientId:
      process.env.DIASEND_CLIENT_ID ||
      "a486o3nvdu88cg0sos4cw8cccc0o0cg.api.diasend.com",
    clientSecret:
      process.env.DIASEND_CLIENT_SECRET || "8imoieg4pyos04s44okoooowkogsco4",
    username: process.env.DIASEND_USERNAME,
    password: process.env.DIASEND_PASSWORD,
  },
  nightscout: {
    url: process.env.NIGHTSCOUT_URL,
    apiSecret: process.env.NIGHTSCOUT_API_SECRET,
  },
};