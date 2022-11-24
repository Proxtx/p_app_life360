import { registerAppEvent } from "../../private/playbackLoader.js";
import { genCombine } from "@proxtx/combine-rest/request.js";
import { genModule } from "@proxtx/combine/combine.js";
import StaticMaps from "staticmaps";

export class App {
  updateCheckInterval = 5 * 60 * 1000;

  constructor(config) {
    this.config = config;

    (async () => {
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

      this.mainUrl = new URL(this.config.apiUrl);
      this.mainUrl.pathname = "/";
      this.mainUrl = this.mainUrl.href;

      let users = await this.dataApi.getUsers(config.pwd);
      for (let localUId in users) {
        if (users[localUId].name == config.userName) this.uId = localUId;
      }

      this.options = {
        width: 600,
        height: 600,
        tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=${await this
          .metaApi.mapBoxAccessToken}`,
        tileSize: 512,
      };

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
    let buffer = await map.image.buffer("image/jpeg", {
      quality: 75,
    });

    buffer = buffer.toString("base64");

    return buffer;
  }
}

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
    let locationTraveledThreshold =
      (location.time - lastLocation.time) * 0.0005556; //0.0005556 is equal to 2 km/h but in ms. Meaning 0.0005556 * 1000 * 60 * 60 = 2000 => 2KM
    let distanceTraveled = calcCrow(
      Number(location.latitude),
      Number(location.longitude),
      Number(lastLocation.latitude),
      Number(lastLocation.longitude)
    );
    location.distance = distanceTraveled;
    if (distanceTraveled >= locationTraveledThreshold) {
      if (!activeRoute) {
        activeRoute = [lastLocation];
      }
      movementResetCounter = 10;
      activeRoute.push(location);
    } else if (activeRoute) {
      activeRoute.push(location);
      if (movementResetCounter == 0) {
        if (activeRoute.length > 15) routes.push(activeRoute);
        activeRoute = undefined;
      }
      movementResetCounter--;
    }

    lastLocation = location;
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
