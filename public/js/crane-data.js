// Crane specification & load chart data.
//
// SOURCE: transcribed directly from XCMG certified technical-specification sheets:
//   - QY50KD Truck Crane, technical specifications, 2020-07-01 edition
//   - QY25K5D Truck Crane, technical specifications, 2021-03 (2nd) edition
// All lifting-capacity figures below (main-boom charts and jib charts) are the exact
// values printed in those documents (kg), not interpolated or estimated. Radius/angle
// values are exactly as printed. See DATA_NOTES below for two spots worth a second look
// against your paper copy before relying on this for a real lift.
//
// loadCharts: { configName: { boomLength: { radius_m: capacity_kg } } }
// jibCharts:  { configName: { jibLength: { offsetDeg: { boomAngle_deg: capacity_kg } } } }
//   Jib charts are indexed by BOOM ANGLE (as printed on the manufacturer chart), not
//   working radius — the manufacturer does not publish a direct angle→radius table for
//   the jib; cross-check the corresponding "lifting heights" diagram in the spec sheet
//   for the radius that a given angle produces before planning a jib lift.

// ---- Regulatory wind-speed stop-work threshold ----
// ADOSH-SF (Abu Dhabi OSH Center Safety Framework) Code of Practice CoP 34.0 —
// "Safe Use of Lifting Equipment and Lifting Accessories" — requires lifting
// operations to be planned and controlled against adverse weather, with lifting
// suspended once wind conditions become unsafe. This tool applies a 38 km/h
// (≈10.56 m/s) site stop-work wind threshold as the operational limit under that
// Code of Practice. The crane's own manufacturer-rated wind limit (below) still
// applies in full — whichever of the two figures is LOWER governs any given lift.
// Always confirm the current, site-specific wind action limit with your appointed
// person / OSH team; this constant does not replace that determination.
const ADOSH_WIND_STOP_KMH = 38;
const ADOSH_WIND_STOP_MS = Math.round((ADOSH_WIND_STOP_KMH / 3.6) * 100) / 100; // 10.56 m/s
const ADOSH_COP_REFERENCE = 'ADOSH-SF CoP 34.0 – Safe Use of Lifting Equipment and Lifting Accessories';

const DATA_NOTES = [
  {
    model: 'QY50KD',
    note: 'On the 5.5t-counterweight / 6.1x7.1m-outrigger chart (page 12 of the source PDF), the cell at 31.46m boom / 20m radius (3700 kg) is highlighted in the source document. The surrounding values are internally consistent (4700 kg at 18m, 2900 kg at 22m) so it has been transcribed as printed, but treat it as flagged for verification against your paper chart before use.'
  },
  {
    model: 'QY50KD',
    note: 'The two reduced-outrigger-span (6.1x4.7m) charts — 6.5t counterweight (page 13) and 5.5t counterweight (page 14) of the source PDF — are printed with IDENTICAL capacity values in every cell. This is very likely a duplication error in the source document (a 1t counterweight difference should change capacity at least slightly), but since no corrected figures are available, both are transcribed exactly as printed. Confirm the true 5.5t/4.7m figures with XCMG before relying on that specific configuration.'
  }
];

const CRANE_DATA = {
  "QY25K5D": {
    "model": "QY25K5D",
    "maxCapacity": 25,
    "maxBoomLength": 41.0,
    "minBoomLength": 10.5,
    "maxWindSpeed": 14.1,
    "windPressure": 125,
    "boomLengths": [10.5, 14.3, 18.1, 23.8, 29.6, 35.3, 41.0],
    "outrigger": {
      "longitudinalSpan": 5.14,
      "lateralSpan": 6.0,
      "maxReactionForce": 310,
      "floatDiameter": 400
    },
    "loadCharts": {
      "Standard (5.14m x 6.0m Outriggers, Fully Extended)": {
        "10.5": {
                "3": 25000,
                "3.5": 25000,
                "4": 24500,
                "4.5": 22800,
                "5": 20500,
                "5.5": 18500,
                "6": 16800,
                "6.5": 15600,
                "7": 14500,
                "8": 11900
        },
        "14.3": {
                "3": 25000,
                "3.5": 25000,
                "4": 24600,
                "4.5": 22600,
                "5": 21200,
                "5.5": 19200,
                "6": 17300,
                "6.5": 15800,
                "7": 14500,
                "8": 11400,
                "9": 9200,
                "10": 7600,
                "11": 6400
        },
        "18.1": {
                "4": 19500,
                "4.5": 19500,
                "5": 18600,
                "5.5": 17300,
                "6": 16000,
                "6.5": 14800,
                "7": 14200,
                "8": 11100,
                "9": 8900,
                "10": 7300,
                "11": 6000,
                "12": 5000,
                "13": 4200,
                "14": 3500
        },
        "23.8": {
                "4.5": 16600,
                "5": 16500,
                "5.5": 15500,
                "6": 14500,
                "6.5": 13500,
                "7": 12900,
                "8": 11300,
                "9": 9800,
                "10": 8100,
                "11": 6800,
                "12": 5800,
                "13": 5000,
                "14": 4300,
                "15": 3700,
                "16": 3200,
                "18": 2400,
                "20": 1800
        },
        "29.6": {
                "5": 13000,
                "5.5": 12800,
                "6": 12800,
                "6.5": 12500,
                "7": 11500,
                "8": 11000,
                "9": 10100,
                "10": 8600,
                "11": 7300,
                "12": 6200,
                "13": 5400,
                "14": 4700,
                "15": 4100,
                "16": 3600,
                "18": 2800,
                "20": 2100,
                "22": 1600,
                "24": 1200
        },
        "35.3": {
                "6.5": 9000,
                "7": 9000,
                "8": 8900,
                "9": 8200,
                "10": 7600,
                "11": 7000,
                "12": 6500,
                "13": 5700,
                "14": 5000,
                "15": 4400,
                "16": 3900,
                "18": 3000,
                "20": 2400,
                "22": 1900,
                "24": 1400,
                "26": 1100,
                "28": 850
        },
        "41.0": {
                "8": 6600,
                "9": 6500,
                "10": 6200,
                "11": 5800,
                "12": 5600,
                "13": 5200,
                "14": 4900,
                "15": 4400,
                "16": 4050,
                "18": 3250,
                "20": 2600,
                "22": 2100,
                "24": 1650,
                "26": 1300,
                "28": 1000,
                "30": 750,
                "32": 550
        }
}
    },
    "jib": {
      "fixedJibLength": 8.3,
      "offsets": [0, 15, 30],
      "note": "Fixed jib mounted on fully-extended 41.0m main boom. Capacity is read by boom angle, not radius."
    },
    "jibCharts": {
      "Fixed Jib (5.14m x 6.0m Outriggers, Fully Extended)": {
        "8.3": {
                "0": {
                        "78": 2800,
                        "75": 2800,
                        "72": 2750,
                        "70": 2650,
                        "65": 2100,
                        "60": 1450,
                        "55": 950,
                        "50": 600,
                        "45": 350
                },
                "15": {
                        "78": 2500,
                        "75": 2400,
                        "72": 2200,
                        "70": 2100,
                        "65": 1800,
                        "60": 1350,
                        "55": 900,
                        "50": 550,
                        "45": 300
                },
                "30": {
                        "78": 1900,
                        "75": 1750,
                        "72": 1700,
                        "70": 1600,
                        "65": 1500,
                        "60": 1400,
                        "55": 900,
                        "50": 500,
                        "45": 300
                }
        }
}
    }
  },
  "QY50KD": {
    "model": "QY50KD",
    "maxCapacity": 50,
    "maxBoomLength": 43.5,
    "minBoomLength": 11.4,
    "maxWindSpeed": 14.1,
    "windPressure": 125,
    "boomLengths": [11.4, 15.41, 19.42, 25.44, 31.46, 37.48, 43.5],
    "outrigger": {
      "longitudinalSpan": 6.1,
      "lateralSpanFull": 7.1,
      "lateralSpanReduced": 4.7,
      "maxReactionForce": 490,
      "floatDiameter": 450
    },
    "loadCharts": {
      "6.5t Counterweight (6.1m x 7.1m Outriggers, Full Span)": {
        "11.4": {
                "3": 50000,
                "3.5": 50000,
                "4": 48000,
                "4.5": 45000,
                "5": 41000,
                "5.5": 36500,
                "6": 33000,
                "7": 27000,
                "8": 22200,
                "9": 17500
        },
        "15.41": {
                "3": 45000,
                "3.5": 45000,
                "4": 45000,
                "4.5": 43000,
                "5": 40000,
                "5.5": 36000,
                "6": 32500,
                "7": 26600,
                "8": 22600,
                "9": 18000,
                "10": 14600,
                "12": 10100
        },
        "19.42": {
                "4": 35000,
                "4.5": 33000,
                "5": 32000,
                "5.5": 29000,
                "6": 27000,
                "7": 24500,
                "8": 22500,
                "9": 17600,
                "10": 14200,
                "12": 10000,
                "14": 7200,
                "16": 5300
        },
        "25.44": {
                "4": 25000,
                "4.5": 25000,
                "5": 25000,
                "5.5": 25000,
                "6": 23300,
                "7": 21000,
                "8": 19000,
                "9": 17000,
                "10": 15400,
                "12": 10700,
                "14": 7900,
                "16": 6000,
                "18": 4600,
                "20": 3500,
                "22": 2700
        },
        "31.46": {
                "5": 18500,
                "5.5": 18500,
                "6": 18500,
                "7": 18500,
                "8": 17700,
                "9": 16300,
                "10": 15000,
                "12": 11300,
                "14": 8400,
                "16": 6500,
                "18": 5100,
                "20": 4000,
                "22": 3100,
                "24": 2500,
                "26": 1800
        },
        "37.48": {
                "7": 14000,
                "8": 13200,
                "9": 12500,
                "10": 11800,
                "12": 10300,
                "14": 8800,
                "16": 6800,
                "18": 5400,
                "20": 4300,
                "22": 3600,
                "24": 2800,
                "26": 2200,
                "28": 1700,
                "30": 1300
        },
        "43.5": {
                "8": 9500,
                "9": 9500,
                "10": 9300,
                "12": 8600,
                "14": 7900,
                "16": 7100,
                "18": 5600,
                "20": 4500,
                "22": 3700,
                "24": 3000,
                "26": 2400,
                "28": 1950,
                "30": 1500,
                "32": 1200
        }
},
      "5.5t Counterweight (6.1m x 7.1m Outriggers, Full Span)": {
        "11.4": {
                "3": 50000,
                "3.5": 50000,
                "4": 48000,
                "4.5": 45000,
                "5": 40000,
                "5.5": 36000,
                "6": 32500,
                "7": 26800,
                "8": 21000,
                "9": 16500
        },
        "15.41": {
                "3": 45000,
                "3.5": 45000,
                "4": 45000,
                "4.5": 43000,
                "5": 40000,
                "5.5": 35700,
                "6": 31800,
                "7": 26500,
                "8": 21600,
                "9": 17200,
                "10": 13800,
                "12": 9500
        },
        "19.42": {
                "4": 35000,
                "4.5": 33000,
                "5": 32000,
                "5.5": 29000,
                "6": 27000,
                "7": 24500,
                "8": 22000,
                "9": 17100,
                "10": 13700,
                "12": 9400,
                "14": 6700,
                "16": 4900
        },
        "25.44": {
                "4": 25000,
                "4.5": 25000,
                "5": 25000,
                "5.5": 25000,
                "6": 23300,
                "7": 21000,
                "8": 19000,
                "9": 17000,
                "10": 14600,
                "12": 10100,
                "14": 7400,
                "16": 5500,
                "18": 4200,
                "20": 3200,
                "22": 2400
        },
        "31.46": {
                "5": 18500,
                "5.5": 18500,
                "6": 18500,
                "7": 18500,
                "8": 17700,
                "9": 16300,
                "10": 15000,
                "12": 10700,
                "14": 7900,
                "16": 6100,
                "18": 4700,
                "20": 3700,
                "22": 2900,
                "24": 2200,
                "26": 1700
        },
        "37.48": {
                "7": 14000,
                "8": 13200,
                "9": 12500,
                "10": 11800,
                "12": 10300,
                "14": 8300,
                "16": 6400,
                "18": 5000,
                "20": 4000,
                "22": 3200,
                "24": 2500,
                "26": 2000,
                "28": 1500,
                "30": 1100
        },
        "43.5": {
                "8": 9500,
                "9": 9500,
                "10": 9300,
                "12": 8600,
                "14": 7900,
                "16": 6600,
                "18": 5300,
                "20": 4200,
                "22": 3400,
                "24": 2700,
                "26": 2200,
                "28": 1700,
                "30": 1400,
                "32": 1000
        }
},
      "6.5t Counterweight (6.1m x 4.7m Outriggers, Reduced Span)": {
        "11.4": {
                "3": 50000,
                "3.5": 50000,
                "4": 46300,
                "4.5": 34500,
                "5": 27100,
                "5.5": 22000,
                "6": 18400,
                "7": 13400,
                "8": 10200,
                "9": 7900
        },
        "15.41": {
                "3": 45000,
                "3.5": 45000,
                "4": 45000,
                "4.5": 34500,
                "5": 27100,
                "5.5": 22000,
                "6": 18300,
                "7": 13400,
                "8": 10100,
                "9": 7900,
                "10": 6200,
                "12": 3900
        },
        "19.42": {
                "4": 35000,
                "4.5": 33000,
                "5": 27100,
                "5.5": 22000,
                "6": 18400,
                "7": 13400,
                "8": 10100,
                "9": 7900,
                "10": 6200,
                "12": 3900,
                "14": 2400,
                "16": 1300
        },
        "25.44": {
                "4": 25000,
                "4.5": 25000,
                "5": 25000,
                "5.5": 23500,
                "6": 19700,
                "7": 14600,
                "8": 11200,
                "9": 8900,
                "10": 7200,
                "12": 4900,
                "14": 3300,
                "16": 2200,
                "18": 1400,
                "20": 800
        },
        "31.46": {
                "5": 18500,
                "5.5": 18500,
                "6": 18500,
                "7": 15300,
                "8": 12000,
                "9": 9600,
                "10": 7900,
                "12": 5500,
                "14": 3900,
                "16": 2800,
                "18": 1900,
                "20": 1300,
                "22": 800
        },
        "37.48": {
                "7": 14000,
                "8": 12200,
                "9": 9800,
                "10": 8100,
                "12": 5700,
                "14": 4100,
                "16": 3000,
                "18": 2200,
                "20": 1600,
                "22": 1100,
                "24": 600
        },
        "43.5": {
                "8": 9500,
                "9": 9500,
                "10": 8300,
                "12": 5900,
                "14": 4400,
                "16": 3200,
                "18": 2400,
                "20": 1800,
                "22": 1300,
                "24": 800,
                "26": 500
        }
},
      "5.5t Counterweight (6.1m x 4.7m Outriggers, Reduced Span)": {
        "11.4": {
                "3": 50000,
                "3.5": 50000,
                "4": 46300,
                "4.5": 34500,
                "5": 27100,
                "5.5": 22000,
                "6": 18400,
                "7": 13400,
                "8": 10200,
                "9": 7900
        },
        "15.41": {
                "3": 45000,
                "3.5": 45000,
                "4": 45000,
                "4.5": 34500,
                "5": 27100,
                "5.5": 22000,
                "6": 18300,
                "7": 13400,
                "8": 10100,
                "9": 7900,
                "10": 6200,
                "12": 3900
        },
        "19.42": {
                "4": 35000,
                "4.5": 33000,
                "5": 27100,
                "5.5": 22000,
                "6": 18400,
                "7": 13400,
                "8": 10100,
                "9": 7900,
                "10": 6200,
                "12": 3900,
                "14": 2400,
                "16": 1300
        },
        "25.44": {
                "4": 25000,
                "4.5": 25000,
                "5": 25000,
                "5.5": 23500,
                "6": 19700,
                "7": 14600,
                "8": 11200,
                "9": 8900,
                "10": 7200,
                "12": 4900,
                "14": 3300,
                "16": 2200,
                "18": 1400,
                "20": 800
        },
        "31.46": {
                "5": 18500,
                "5.5": 18500,
                "6": 18500,
                "7": 15300,
                "8": 12000,
                "9": 9600,
                "10": 7900,
                "12": 5500,
                "14": 3900,
                "16": 2800,
                "18": 1900,
                "20": 1300,
                "22": 800
        },
        "37.48": {
                "7": 14000,
                "8": 12200,
                "9": 9800,
                "10": 8100,
                "12": 5700,
                "14": 4100,
                "16": 3000,
                "18": 2200,
                "20": 1600,
                "22": 1100,
                "24": 600
        },
        "43.5": {
                "8": 9500,
                "9": 9500,
                "10": 8300,
                "12": 5900,
                "14": 4400,
                "16": 3200,
                "18": 2400,
                "20": 1800,
                "22": 1300,
                "24": 800,
                "26": 500
        }
}
    },
    "jib": {
      "jibLengths": [9.5, 16],
      "offsets": [0, 15, 30],
      "note": "2-section jib mounted on fully-extended 43.5m main boom. Capacity is read by boom angle, not radius."
    },
    "jibCharts": {
      "Jib (6.1m x 7.1m Outriggers, Full Span)": {
        "9.5": {
                "0": {
                        "78": 4500,
                        "75": 4000,
                        "72": 3500,
                        "70": 3200,
                        "65": 2550,
                        "60": 2000,
                        "55": 1200,
                        "50": 600
                },
                "15": {
                        "78": 3000,
                        "75": 2700,
                        "72": 2500,
                        "70": 2300,
                        "65": 2100,
                        "60": 1700,
                        "55": 1000,
                        "50": 500
                },
                "30": {
                        "78": 2500,
                        "75": 2400,
                        "72": 2300,
                        "70": 2200,
                        "65": 1900,
                        "60": 1600,
                        "55": 900,
                        "50": 500
                }
        },
        "16": {
                "0": {
                        "78": 2800,
                        "75": 2200,
                        "72": 1900,
                        "70": 1800,
                        "65": 1600,
                        "60": 1200,
                        "55": 850,
                        "50": 450
                },
                "15": {
                        "78": 1500,
                        "75": 1300,
                        "72": 1200,
                        "70": 1200,
                        "65": 1000,
                        "60": 900,
                        "55": 700,
                        "50": 400
                },
                "30": {
                        "78": 1200,
                        "75": 1100,
                        "72": 1000,
                        "70": 950,
                        "65": 850,
                        "60": 750,
                        "55": 650,
                        "50": 350
                }
        }
},
      "Jib (6.1m x 4.7m Outriggers, Reduced Span)": {
        "9.5": {
                "0": {
                        "78": 4500,
                        "75": 3800,
                        "72": 2700,
                        "70": 2100,
                        "65": 1150,
                        "60": 500
                },
                "15": {
                        "78": 3000,
                        "75": 2700,
                        "72": 2400,
                        "70": 1900,
                        "65": 1000,
                        "60": 500
                },
                "30": {
                        "78": 2500,
                        "75": 2400,
                        "72": 2200,
                        "70": 1700,
                        "65": 1000,
                        "60": 400
                }
        },
        "16": {
                "0": {
                        "78": 2800,
                        "75": 2200,
                        "72": 1800,
                        "70": 1600,
                        "65": 800
                },
                "15": {
                        "78": 1500,
                        "75": 1300,
                        "72": 1200,
                        "70": 1100,
                        "65": 600
                },
                "30": {
                        "78": 1200,
                        "75": 1100,
                        "72": 950,
                        "70": 900,
                        "65": 600
                }
        }
}
    }
  }
};
