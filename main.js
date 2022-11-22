import { registerAppEvent } from "../../private/playbackLoader.js";
import { genCombine } from "@proxtx/combine-rest/request.js";
import { genModule } from "@proxtx/combine/combine.js";
import StaticMaps from "staticmaps";

export class App {
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

      let users = await this.dataApi.getUsers(config.pwd);
      let uId;
      for (let localUId in users) {
        if (users[localUId].name == config.userName) uId = localUId;
      }

      const options = {
        width: 600,
        height: 600,
        tileUrl: `https://api.mapbox.com/styles/v1/mapbox/streets-v11/tiles/{z}/{x}/{y}?access_token=${await this
          .metaApi.mapBoxAccessToken}`,
        tileSize: 512,
      };

      let locations = await this.locationsApi.getLocationsInTimespan(
        config.pwd,
        [uId],
        1669057009975 - 12 * 60 * 60 * 1000,
        1669057009975
      );

      let routes = findRoutsInData(locations);

      for (let route of routes) {
        let coords = [];
        let map = new StaticMaps(options);

        for (let location of route) {
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

        /*registerAppEvent({
          app: "Life 360",
          type: "Traveled",
          text: `${config.userName} traveled from ${
            route[0].address ? route[0].address : "unknown"
          } to ${
            route[route.length - 1].address
              ? route[route.length - 1].address
              : "unknown"
          }`,
          media: [{ buffer, type: "image/jpeg" }],
          time: route[0].time,
          points: config.points,
        });

        if (route[route.length - 1].time - route[0].time > 1200000)
          registerAppEvent({
            app: "Life 360",
            type: "Traveled",
            text: `${config.userName} traveled from ${
              route[0].address ? route[0].address : "unknown"
            } to ${
              route[route.length - 1].address
                ? route[route.length - 1].address
                : "unknown"
            }`,
            media: [{ buffer, type: "image/jpeg" }],
            time: route[route.length - 1].time,
            points: config.points,
          });*/
      }
      console.log("done");
    })();
  }
}

const findRoutsInData = (locations) => {
  let times = Object.keys(locations).sort((a, b) => b - a);
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
      (lastLocation.time - location.time) * 0.0005556; //0.0005556 is equal to 2 km/h but in ms. Meaning 0.0005556 * 1000 * 60 * 60 = 2000 => 2KM
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
        if (activeRoute.length >= 15) routes.push(activeRoute);
        activeRoute = undefined;
      }
      movementResetCounter--;
    }

    lastLocation = location;
  }

  return routes;
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
