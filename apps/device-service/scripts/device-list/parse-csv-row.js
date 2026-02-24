/**
 * Parse a single CSV line with quoted fields (handles commas and "" inside quotes).
 * @param {string} line
 * @returns {string[]}
 */
function parseCsvRow(line) {
  const out = [];
  let i = 0;
  let afterField = false; // true after we just pushed a field (so next comma is delimiter only)
  while (i < line.length) {
    if (line[i] === '"') {
      let field = '';
      i += 1;
      while (i < line.length) {
        if (line[i] === '"' && line[i + 1] === '"') {
          field += '"';
          i += 2;
        } else if (line[i] === '"') {
          i += 1;
          break;
        } else {
          field += line[i];
          i += 1;
        }
      }
      out.push(field);
      afterField = true;
    } else if (line[i] === ',') {
      if (!afterField) out.push('');
      i += 1;
      afterField = false;
    } else {
      let field = '';
      while (i < line.length && line[i] !== ',') {
        field += line[i];
        i += 1;
      }
      out.push(field);
      afterField = true;
      if (i < line.length) i += 1;
    }
  }
  return out;
}

/**
 * Parse DynamoDB-style list of strings: [{""S"":""x""},{""S"":""y""}] -> ["x","y"]
 * @param {string} raw
 * @returns {string[]|null}
 */
function parseDynamoStringList(raw) {
  if (raw == null || String(raw).trim() === '') return [];
  try {
    const s = String(raw).replace(/""/g, '"');
    const arr = JSON.parse(s);
    if (!Array.isArray(arr)) return null;
    return arr.map((item) => (item && item.S != null ? item.S : null)).filter(Boolean);
  } catch {
    return null;
  }
}

function coerceBool(val) {
  if (val === true || val === 'true' || val === '1') return true;
  if (val === false || val === 'false' || val === '0' || val === '') return false;
  return Boolean(val);
}

function coerceInt(val) {
  if (val === '' || val == null) return 0;
  const n = parseInt(String(val), 10);
  return Number.isNaN(n) ? 0 : n;
}

const CSV_HEADERS = [
  'pk', 'sk', 'ACDeviceInfoUserDataServiceUUIDKey', 'animationLink', 'autoSyncDelay', 'category',
  'companyIdentifier', 'countriesSupported', 'deviceDetails', 'deviceGroupId', 'deviceId', 'deviceImage',
  'deviceIncludedGroupId', 'deviceSecondaryIncludedGroupId', 'displayName', 'enabled', 'externalVideoLink',
  'isAutoSyncSupported', 'manufacturerImage', 'manufacturerName', 'name', 'noOfUsers',
  'pairingErrorAnimationLink', 'requiresPairing', 'sk3', 'sk4', 'supportedVitals',
  'supportsUserAuthentication', 'template', 'useExtensionProtocol',
];

/**
 * Convert a CSV row (array of string values) to a DynamoDB item for DEVICE_LIST.
 * @param {string[]} values - same length as CSV_HEADERS
 * @returns {Record<string, unknown>|null}
 */
function rowToItem(values) {
  if (values.length < CSV_HEADERS.length) return null;
  const row = {};
  CSV_HEADERS.forEach((h, i) => { row[h] = values[i]; });

  const pk = row.pk;
  const sk = row.sk;
  const deviceId = row.deviceId;
  const category = row.category;
  if (!pk || !sk || !deviceId || !category) return null;

  const countriesSupported = parseDynamoStringList(row.countriesSupported) || [];
  const supportedVitals = parseDynamoStringList(row.supportedVitals) || [];

  const item = {
    pk: 'DEVICE_LIST',
    sk,
    sk3: row.sk3 || String(deviceId).toUpperCase().replace(/\s+/g, '_'),
    sk4: row.sk4 || String(category).toUpperCase(),
    category,
    deviceId,
    name: row.name || deviceId,
    displayName: row.displayName || row.name || deviceId,
    enabled: coerceBool(row.enabled),
    countriesSupported,
    supportedVitals,
    ACDeviceInfoUserDataServiceUUIDKey: row.ACDeviceInfoUserDataServiceUUIDKey || '',
    animationLink: row.animationLink || '',
    autoSyncDelay: coerceInt(row.autoSyncDelay),
    companyIdentifier: row.companyIdentifier || '',
    deviceDetails: row.deviceDetails || '',
    deviceGroupId: row.deviceGroupId || '',
    deviceImage: row.deviceImage || '',
    deviceIncludedGroupId: row.deviceIncludedGroupId || '',
    deviceSecondaryIncludedGroupId: row.deviceSecondaryIncludedGroupId || '',
    externalVideoLink: row.externalVideoLink || '',
    isAutoSyncSupported: coerceBool(row.isAutoSyncSupported),
    manufacturerImage: row.manufacturerImage || '',
    manufacturerName: row.manufacturerName || '',
    noOfUsers: coerceInt(row.noOfUsers),
    pairingErrorAnimationLink: row.pairingErrorAnimationLink || '',
    requiresPairing: coerceBool(row.requiresPairing),
    supportsUserAuthentication: coerceBool(row.supportsUserAuthentication),
    template: coerceInt(row.template),
    useExtensionProtocol: coerceBool(row.useExtensionProtocol),
  };
  return item;
}

module.exports = { parseCsvRow, parseDynamoStringList, rowToItem, CSV_HEADERS };
