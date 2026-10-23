const button = document.querySelector('#start');
const countries = ['JPN','FRA','BRA','AUS','KEN','CAN','ITA','NOR','IND','MEX','NZL','ARG','THA','PRT','ZAF','KOR'];
const setText = (id, text) => document.getElementById(id).textContent = text;
const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Each request waits for the data it needs from the previous step.
async function getJSON(url) {
  const response = await fetch(url, {signal: AbortSignal.timeout(20000)});
  if (!response.ok) throw new Error(`The service returned ${response.status}.`);
  return response.json();
}
function step(number, state) {
  document.getElementById(`step${number}`).className = state;
}

button.addEventListener('click', async () => {
  button.disabled = true;
  photoRequest++;
  document.getElementById('place-photo').hidden = true;
  document.getElementById('error').hidden = true;
  document.getElementById('light').classList.add('busy');
  document.getElementById('result-circle').setAttribute('visibility','hidden');
  document.getElementById('drawing').setAttribute('aria-label','A blank drawing area');
  [1,2,3].forEach(number => step(number,''));
  setText('country','Picking a place...');
  setText('location','Asking the World Bank for a capital and its location.');
  setText('temperature','Waiting for a place');
  setText('weather','No weather request yet.');
  setText('math','Waiting for weather');
  setText('mapping','No circle has been made.');
  setText('result-label','Nothing here yet');
  setText('finish','First, we need somewhere to go.');
  let currentStep = 1;
  try {
    step(1,'active'); setText('status','Finding a place');
    const code = countries[Math.floor(Math.random() * countries.length)];
    const countryURL = `https://api.worldbank.org/v2/country/${code}?format=json`;
    const payload = await getJSON(countryURL);
    const place = payload?.[1]?.[0];
    const lat = Number(place?.latitude), lon = Number(place?.longitude);
    if (!place?.capitalCity || !place.latitude || !place.longitude || !Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error('No capital location came back.');
    void loadCityPhoto(place);
    setText('country',place.name);
    setText('location',`${place.capitalCity} · ${lat.toFixed(2)}, ${lon.toFixed(2)}`);
    step(1,'done'); step(2,'active'); currentStep = 2;
    setText('status',`Checking the weather in ${place.capitalCity}`);
    setText('temperature','Checking outside...');
    setText('weather','Using the coordinates from step 1.');
    const weatherURL = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,wind_speed_10m,wind_direction_10m&temperature_unit=celsius&wind_speed_unit=kmh&timezone=auto`;
    const weather = await getJSON(weatherURL);
    const data = weather.current;
    const temp = data?.temperature_2m, speed = data?.wind_speed_10m, direction = data?.wind_direction_10m;
    if (![temp,speed,direction].every(Number.isFinite)) throw new Error('Some weather data is missing.');
    setText('temperature',`${temp} °C`);
    setText('weather',`Wind: ${speed} km/h at ${direction}°. Weather time: ${data.time.replace('T',' ')} (${weather.timezone}).`);
    step(2,'done'); step(3,'active'); currentStep = 3;
    // The same weather values always make the same circle.
    const radius = Math.round(clamp(25 + speed * 1.5,25,100));
    const hue = Math.round(clamp(220 - (temp + 10) * 5,0,240));
    const angle = (direction - 90) * Math.PI / 180;
    const x = Math.round(400 + Math.cos(angle) * 150);
    const y = Math.round(160 + Math.sin(angle) * 35);
    setText('math',`Radius: ${radius} px`);
    setText('mapping',`Color: ${hue}° hue. Position: ${x}, ${y}. Made from the weather above.`);
    const circle = document.getElementById('result-circle');
    for (const [key,value] of Object.entries({r:radius,cx:x,cy:y,fill:`hsl(${hue} 72% 55%)`,visibility:'visible'})) circle.setAttribute(key,value);
    document.getElementById('drawing').setAttribute('aria-label',`A circle made from the weather in ${place.capitalCity}. Radius ${radius} pixels, color hue ${hue} degrees.`);
    setText('result-label',`${place.capitalCity} made this`);
    setText('finish',`We checked the weather in ${place.capitalCity}. Here is your circle.`);
    setText('status','Done. It is a circle.'); step(3,'done');
  } catch (error) {
    const box = document.getElementById('error');
    box.textContent = `Step ${currentStep} stopped. ${error.message} Check your connection and try again.`;
    box.hidden = false;
    setText('status',`Stopped at step ${currentStep}`);
    setText('finish','No data, no circle. Try once more.');
    setText('result-label','No result');
  } finally {
    document.getElementById('light').classList.remove('busy');
    button.disabled = false;
  }
});

// The country response also tells us which city's photo to look for.
let photoRequest = 0;
async function loadCityPhoto(place) {
  const request = ++photoRequest;
  const figure = document.getElementById('place-photo');
  try {
    const summary = await getJSON(`https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(place.capitalCity)}`);
    const source = summary.originalimage?.source || summary.thumbnail?.source;
    if (!source || !summary.coordinates) return;
    if (Math.abs(summary.coordinates.lat - Number(place.latitude)) > 1 || Math.abs(summary.coordinates.lon - Number(place.longitude)) > 1) return;
    const url = new URL(source);
    const parts = url.pathname.split('/');
    const filename = decodeURIComponent(parts[parts.includes('thumb') ? parts.indexOf('thumb') + 3 : parts.length - 1]);
    if (/flag|coat.of.arms|logo|map\b|\.svg$/i.test(filename)) return;
    const infoURL = new URL('https://commons.wikimedia.org/w/api.php');
    infoURL.search = new URLSearchParams({action:'query',format:'json',origin:'*',titles:`File:${filename}`,prop:'imageinfo',iiprop:'url|extmetadata',iiurlwidth:'1400'});
    const metadata = await getJSON(infoURL);
    const info = Object.values(metadata.query?.pages || {})[0]?.imageinfo?.[0];
    if (!info?.thumburl || !info.extmetadata?.Artist?.value || !info.extmetadata?.LicenseShortName?.value) return;
    const plainText = html => new DOMParser().parseFromString(html,'text/html').body.textContent.trim();
    const author = plainText(info.extmetadata.Artist.value);
    const license = plainText(info.extmetadata.LicenseShortName.value);
    if (request !== photoRequest) return;
    const image = document.getElementById('city-photo');
    image.onload = () => { if (request === photoRequest) figure.hidden = false; };
    image.onerror = () => { if (request === photoRequest) figure.hidden = true; };
    image.alt = `A view of ${place.capitalCity}, ${place.name}`;
    image.src = info.thumburl;
    setText('photo-place',`${place.capitalCity}, ${place.name}`);
    const credit = document.getElementById('photo-credit');
    credit.textContent = `${author} · ${license}`;
    credit.href = info.descriptionurl;
  } catch {
    // A missing photo should not stop the weather or the drawing.
    if (request === photoRequest) figure.hidden = true;
  }
}
