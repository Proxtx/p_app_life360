import { registerAppEvent } from "../../private/playbackLoader.js";
import { genCombine } from "@proxtx/combine-rest/request.js";
import { genModule } from "@proxtx/combine/combine.js";
import StaticMaps from "staticmaps";
import { createCanvas } from "canvas";

export class App {
  updateCheckInterval = 5 * 60 * 1000;

  constructor(config) {
    this.config = config;

    (async () => {
      if (config.disable) return;
      this.locationsApi = await genCombine(
        config.apiUrl,
        "public/locations.js",
        genModule
      );

      this.metaApi = await genCombine(
        config.apiUrl,
        "public/meta.js",
        genModule
      );

      this.dataApi = await genCombine(
        config.apiUrl,
        "public/data.js",
        genModule
      );

      this.statsApi = await genCombine(
        config.apiUrl,
        "public/stats.js",
        genModule
      );

      this.mainUrl = new URL(this.config.apiUrl);
      this.mainUrl.pathname = "/";
      this.mainUrl = this.mainUrl.href;

      let users = await this.dataApi.getUsers(config.pwd);
      for (let localUId in users) {
        if (users[localUId].name == config.userName) this.uId = localUId;
      }

      this.batteryDevelopmentLoop();

      this.options = {
        width: 600,
        height: 600,
        tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=${await this
          .metaApi.mapBoxAccessToken}`,
        tileSize: 512,
      };

      // DEBUG
      /*let locations = await this.locationsApi.getLocationsInTimespan(
        this.config.pwd,
        [this.uId],
        Date.now() - 12 * 60 * 60 * 1000,
        Date.now()
      );

      let routes = findRoutsInData(locations).routes;

      for (let route of routes) {
        this.generateMapBuffer(route);
      }

      return; */
      while (true) {
        (async () => {
          try {
            await this.checkForNewRoutes();
          } catch (e) {
            console.log(e);
          }
        })();
        await new Promise((r) => setTimeout(r, this.updateCheckInterval));
      }
    })();
  }

  async batteryDevelopmentLoop() {
    let lastDate;
    while (true) {
      let d = new Date();
      if (d.getDay() != lastDate && d.getHours() > 22 && d.getMinutes() > 50) {
        await this.generateBatteryDevelopment();
        lastDate = d.getDay();
      }

      await new Promise((r) => setTimeout(r, 60 * 1000));
    }
  }

  async generateBatteryDevelopment() {
    let statsJobId = await this.statsApi.createStatsJob(
      this.config.pwd,
      this.uId,
      Date.now() - 1000 * 60 * 60 * 24,
      Date.now()
    );

    let result;
    do {
      result = await this.statsApi.statsJobStatus(this.config.pwd, statsJobId);
    } while (!result.result);
    let batteryData;
    for (let entry of result.result) {
      if (entry.title == "battery.") batteryData = entry;
    }

    let canvas = createCanvas(600, 600);
    drawDataOnCanvas(canvas, batteryData);

    registerAppEvent({
      app: "Life360",
      type: "Battery Development",
      text: "Battery Development over the Day.",
      media: [
        {
          buffer: canvas.toBuffer("image/png").toString("base64"),
          type: "image/png",
        },
      ],
      open: this.mainUrl,
      time: Date.now(),
      points: this.config.points,
    });
  }

  async checkForNewRoutes() {
    let locations = await this.locationsApi.getLocationsInTimespan(
      this.config.pwd,
      [this.uId],
      Date.now() - 12 * 60 * 60 * 1000,
      Date.now()
    );

    let routes = findRoutsInData(locations);

    routes.routes.reverse();

    let route = routes.routes[0];

    if (
      route &&
      route[route.length - 1].time > Date.now() - this.updateCheckInterval
    ) {
      registerAppEvent({
        app: "Life 360",
        type: "Traveled",
        text: `${this.config.userName} traveled from ${
          route[0].address ? route[0].address : "unknown"
        } to ${
          route[route.length - 1].address
            ? route[route.length - 1].address
            : "unknown"
        }`,
        media: [
          { buffer: await this.generateMapBuffer(route), type: "image/jpeg" },
        ],
        open: this.mainUrl,
        time: route[0].time,
        points: this.config.points,
      });
    }
  }

  async generateMapBuffer(locations) {
    let coords = [];
    let map = new StaticMaps(this.options);

    for (let location of locations) {
      coords.push([Number(location.longitude), Number(location.latitude)]);
    }

    let polyline = {
      coords,
      color: "#ff0000",
      width: 3,
    };

    map.addLine(polyline);

    await map.render();

    //DEBUG
    //await map.image.save(Math.floor(Math.random() * 1000) + ".jpg");

    let buffer = await map.image.buffer("image/jpeg", {
      quality: 75,
    });

    buffer = buffer.toString("base64");

    return buffer;
  }
}

const drawDataOnCanvas = (canvas, data) => {
  let ctx = canvas.getContext("2d");
  ctx.fillStyle = data.background;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = data.color;
  for (let pointIndex in data.dataPoints) {
    let point = data.dataPoints[pointIndex];
    ctx.fillRect(
      pointIndex * (canvas.width / data.dataPoints.length),
      canvas.height,
      canvas.width / data.dataPoints.length + 1,
      (canvas.height / data.max) * -point
    );
  }
};

const findRoutsInData = (locations) => {
  let times = Object.keys(locations).sort((a, b) => a - b);
  let uId = Object.keys(locations[times[0]])[0];
  let routes = [];
  let activeRoute;
  let movementResetCounter;

  let lastLocation = locations[times[0]][uId];
  lastLocation.time = 0;

  for (let time of times) {
    let location = locations[time][uId];
    location.time = time;
    let timeElapsed = location.time - lastLocation.time;
    let locationTraveledThreshold = timeElapsed * 0.00005556; //0.0005556 is equal to 2 km/h but in ms. Meaning 0.0005556 * 1000 * 60 * 60 = 2000 => 2KM
    let distanceTraveled = calcCrow(
      Number(location.latitude),
      Number(location.longitude),
      Number(lastLocation.latitude),
      Number(lastLocation.longitude)
    );
    let withinReasonableTimeFrame = timeElapsed < 1000 * 60 * 15;
    location.distance = distanceTraveled;
    location.threshold = locationTraveledThreshold;
    location.timeElapsed = timeElapsed;
    if (
      distanceTraveled >= locationTraveledThreshold &&
      withinReasonableTimeFrame
    ) {
      if (!activeRoute) {
        activeRoute = [lastLocation];
      }
      movementResetCounter = 15;
      activeRoute.push(location);
    } else if (activeRoute) {
      activeRoute.push(location);
      if (movementResetCounter == 0 || !withinReasonableTimeFrame) {
        if (activeRoute.length > 20) routes.push(activeRoute);
        activeRoute = undefined;
      }
      movementResetCounter--;
    }

    lastLocation = location;
  }

  if (activeRoute) {
    routes.push(activeRoute);
  }

  return { routes };
};

const calcCrow = (lat1, lon1, lat2, lon2) => {
  let R = 6371;
  let dLat = toRad(lat2 - lat1);
  let dLon = toRad(lon2 - lon1);
  lat1 = toRad(lat1);
  lat2 = toRad(lat2);

  let a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLon / 2) * Math.sin(dLon / 2) * Math.cos(lat1) * Math.cos(lat2);
  let c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  let d = R * c;
  return d * 1000;
};

const toRad = (Value) => {
  return (Value * Math.PI) / 180;
};
