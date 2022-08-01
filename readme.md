# Diasend API

## Authentication & Authorization

Diasend uses OAuth2 Resource-Owner Password grant with the following client credentials:

ClientID: a486o3nvdu88cg0sos4cw8cccc0o0cg.api.diasend.com
ClientSecret: 8imoieg4pyos04s44okoooowkogsco4

```
curl -H 'Content-Type: application/x-www-form-urlencoded' --compressed -H 'User-Agent: diasend/1.13.0 (iPhone; iOS 15.5; Scale/3.00)'
-H 'Authorization: Basic YTQ4Nm8zbnZkdTg4Y2cwc29zNGN3OGNjY2MwbzBjZy5hcGkuZGlhc2VuZC5jb206OGltb2llZzRweW9zMDRzNDRva29vb293a29nc2NvNA=='
-X POST https://api.diasend.com/1/oauth2/token
-d 'grant_type=password&password=<retracted>&scope=PATIENT%20DIASEND_MOBILE_DEVICE_DATA_RW&username=<retracted>'
```

## CGM Data

### Combined

Includes CGM readings and insulin rates

```
curl
-H 'User-Agent: diasend/1.13.0 (iPhone; iOS 15.5; Scale/3.00)'
-H 'Authorization: Bearer <retracted>'
--compressed
'https://api.diasend.com/1/patient/data?type=combined&date_from=2022-07-27T10:42:50&date_to=2022-08-01T10:42:50&unit=mg_dl&ext=event'
```

Sample Response

```json
[
  {
    "created_at": "2022-07-27T11:37:40",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 155
  },
  {
    "created_at": "2022-07-27T11:41:46",
    "type": "event",
    "value": 202001
  },
  {
    "created_at": "2022-07-27T11:42:02",
    "flags": [
      {
        "description": "Bolus type ezcarb",
        "flag": 1035
      }
    ],
    "programmed_meal": 1,
    "spike_value": 1,
    "suggested": 1,
    "suggestion_based_on_bg": "no",
    "suggestion_based_on_carb": "yes",
    "suggestion_overridden": "no",
    "total_value": 1,
    "type": "insulin_bolus",
    "unit": "U"
  },
  {
    "created_at": "2022-07-27T11:42:25",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      },
      {
        "description": "Calibration",
        "flag": 130
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 120
  },
  {
    "created_at": "2022-07-27T11:42:47",
    "flags": [],
    "type": "carb",
    "unit": "g",
    "value": "24"
  },
  {
    "created_at": "2022-07-27T11:42:49",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 118
  },
  {
    "created_at": "2022-07-27T11:46:47",
    "type": "event",
    "value": 202001
  },
  {
    "created_at": "2022-07-27T11:42:20",
    "flags": [
      {
        "description": "Manual",
        "flag": 126
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 120
  },
  {
    "created_at": "2022-07-27T11:47:41",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 112
  },
  {
    "created_at": "2022-07-27T11:47:57",
    "flags": [
      {
        "description": "Bolus type ezcarb",
        "flag": 1035
      }
    ],
    "programmed_meal": 0.4,
    "spike_value": 0.4,
    "suggested": 0.4,
    "suggestion_based_on_bg": "no",
    "suggestion_based_on_carb": "yes",
    "suggestion_overridden": "no",
    "total_value": 0.4,
    "type": "insulin_bolus",
    "unit": "U"
  },
  {
    "created_at": "2022-07-27T11:48:43",
    "flags": [],
    "type": "carb",
    "unit": "g",
    "value": "11"
  },
  {
    "created_at": "2022-07-27T11:51:46",
    "type": "event",
    "value": 202001
  },
  {
    "created_at": "2022-07-27T11:52:42",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 106
  },
  {
    "created_at": "2022-07-27T11:55:15",
    "flags": [
      {
        "description": "Bolus type ezcarb",
        "flag": 1035
      }
    ],
    "programmed_meal": 0.4,
    "spike_value": 0.4,
    "suggested": 0.4,
    "suggestion_based_on_bg": "no",
    "suggestion_based_on_carb": "yes",
    "suggestion_overridden": "no",
    "total_value": 0.4,
    "type": "insulin_bolus",
    "unit": "U"
  },
  {
    "created_at": "2022-07-27T11:56:00",
    "flags": [],
    "type": "carb",
    "unit": "g",
    "value": "11"
  },
  {
    "created_at": "2022-07-27T11:56:46",
    "type": "event",
    "value": 202001
  },
  {
    "created_at": "2022-07-27T11:57:30",
    "flags": [
      {
        "description": "Bolus type ezcarb",
        "flag": 1035
      }
    ],
    "programmed_meal": 0.2,
    "spike_value": 0.2,
    "suggested": 0.2,
    "suggestion_based_on_bg": "no",
    "suggestion_based_on_carb": "yes",
    "suggestion_overridden": "no",
    "total_value": 0.2,
    "type": "insulin_bolus",
    "unit": "U"
  },
  {
    "created_at": "2022-07-27T11:57:42",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 108
  },
  {
    "created_at": "2022-07-27T11:57:54",
    "flags": [],
    "type": "carb",
    "unit": "g",
    "value": "4"
  },
  {
    "created_at": "2022-07-27T12:00:00",
    "flags": [],
    "type": "insulin_basal",
    "unit": "U/h",
    "value": 0.09
  },
  {
    "created_at": "2022-07-27T12:00:00",
    "flags": [],
    "type": "insulin_basal",
    "unit": "U/h",
    "value": 0
  },
  {
    "created_at": "2022-07-27T12:00:00",
    "flags": [],
    "type": "insulin_basal",
    "unit": "U/h",
    "value": 0.05
  },
  {
    "created_at": "2022-07-27T12:01:46",
    "type": "event",
    "value": 202001
  },
  {
    "created_at": "2022-07-27T12:02:42",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 120
  },
  {
    "created_at": "2022-07-27T12:06:47",
    "type": "event",
    "value": 202001
  }
]
```

### Standard

```
https://api.diasend.com/1/patient/data?
type=standardday
&date_from=2022-07-19T10:42:50
&date_to=2022-08-01T10:42:50
&unit=mg_dl
Authorization: Bearer <retracted>
```

```json
[
  {
    "created_at": "2022-07-20T18:57:49",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      },
      {
        "description": "Calibration",
        "flag": 130
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 203
  },
  {
    "created_at": "2022-07-26T15:27:39",
    "flags": [
      {
        "description": "Continous reading",
        "flag": 123
      }
    ],
    "type": "glucose",
    "unit": "mg/dl",
    "value": 91
  }
]
```
