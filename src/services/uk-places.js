// UK towns and cities mapped to ceremonial counties.
//
// Used by the location picker so every stored area maps cleanly to a county,
// which is what "Near Me" circles match on. Ceremonial counties are used
// rather than administrative ones because they are what people actually say.
//
// Not exhaustive - it covers cities and the larger towns in each county.
// Anyone whose town is missing picks their county directly, which is why
// COUNTIES is exported separately.

var PLACES = [
  // Greater London
  ['London', 'Greater London'],
  ['Croydon', 'Greater London'],
  ['Bromley', 'Greater London'],
  ['Barnet', 'Greater London'],
  ['Ealing', 'Greater London'],
  ['Enfield', 'Greater London'],
  ['Harrow', 'Greater London'],
  ['Hounslow', 'Greater London'],
  ['Kingston upon Thames', 'Greater London'],
  ['Richmond upon Thames', 'Greater London'],
  ['Sutton', 'Greater London'],
  ['Wimbledon', 'Greater London'],
  ['Ilford', 'Greater London'],
  ['Romford', 'Greater London'],
  ['Uxbridge', 'Greater London'],
  ['Wembley', 'Greater London'],

  // Surrey
  ['Guildford', 'Surrey'],
  ['Woking', 'Surrey'],
  ['Epsom', 'Surrey'],
  ['Redhill', 'Surrey'],
  ['Reigate', 'Surrey'],
  ['Camberley', 'Surrey'],
  ['Farnham', 'Surrey'],
  ['Staines-upon-Thames', 'Surrey'],
  ['Esher', 'Surrey'],
  ['Leatherhead', 'Surrey'],
  ['Dorking', 'Surrey'],
  ['Weybridge', 'Surrey'],
  ['Walton-on-Thames', 'Surrey'],
  ['Addlestone', 'Surrey'],
  ['Godalming', 'Surrey'],
  ['Haslemere', 'Surrey'],

  // Kent
  ['Maidstone', 'Kent'],
  ['Canterbury', 'Kent'],
  ['Dartford', 'Kent'],
  ['Gravesend', 'Kent'],
  ['Rochester', 'Kent'],
  ['Chatham', 'Kent'],
  ['Gillingham', 'Kent'],
  ['Ashford', 'Kent'],
  ['Folkestone', 'Kent'],
  ['Dover', 'Kent'],
  ['Margate', 'Kent'],
  ['Ramsgate', 'Kent'],
  ['Tonbridge', 'Kent'],
  ['Royal Tunbridge Wells', 'Kent'],
  ['Sevenoaks', 'Kent'],
  ['Sittingbourne', 'Kent'],

  // Essex
  ['Chelmsford', 'Essex'],
  ['Colchester', 'Essex'],
  ['Southend-on-Sea', 'Essex'],
  ['Basildon', 'Essex'],
  ['Harlow', 'Essex'],
  ['Brentwood', 'Essex'],
  ['Grays', 'Essex'],
  ['Braintree', 'Essex'],
  ['Clacton-on-Sea', 'Essex'],
  ['Loughton', 'Essex'],
  ['Romford', 'Essex'],
  ['Epping', 'Essex'],

  // Hertfordshire
  ['Watford', 'Hertfordshire'],
  ['St Albans', 'Hertfordshire'],
  ['Hemel Hempstead', 'Hertfordshire'],
  ['Stevenage', 'Hertfordshire'],
  ['Welwyn Garden City', 'Hertfordshire'],
  ['Hatfield', 'Hertfordshire'],
  ['Hitchin', 'Hertfordshire'],
  ['Letchworth Garden City', 'Hertfordshire'],
  ['Borehamwood', 'Hertfordshire'],
  ['Bishop\u2019s Stortford', 'Hertfordshire'],
  ['Cheshunt', 'Hertfordshire'],

  // Berkshire
  ['Reading', 'Berkshire'],
  ['Slough', 'Berkshire'],
  ['Bracknell', 'Berkshire'],
  ['Maidenhead', 'Berkshire'],
  ['Windsor', 'Berkshire'],
  ['Newbury', 'Berkshire'],
  ['Wokingham', 'Berkshire'],
  ['Ascot', 'Berkshire'],

  // Buckinghamshire
  ['Milton Keynes', 'Buckinghamshire'],
  ['High Wycombe', 'Buckinghamshire'],
  ['Aylesbury', 'Buckinghamshire'],
  ['Amersham', 'Buckinghamshire'],
  ['Chesham', 'Buckinghamshire'],
  ['Marlow', 'Buckinghamshire'],
  ['Beaconsfield', 'Buckinghamshire'],

  // Oxfordshire
  ['Oxford', 'Oxfordshire'],
  ['Banbury', 'Oxfordshire'],
  ['Bicester', 'Oxfordshire'],
  ['Abingdon', 'Oxfordshire'],
  ['Witney', 'Oxfordshire'],
  ['Didcot', 'Oxfordshire'],

  // Hampshire
  ['Southampton', 'Hampshire'],
  ['Portsmouth', 'Hampshire'],
  ['Basingstoke', 'Hampshire'],
  ['Winchester', 'Hampshire'],
  ['Aldershot', 'Hampshire'],
  ['Farnborough', 'Hampshire'],
  ['Eastleigh', 'Hampshire'],
  ['Fareham', 'Hampshire'],
  ['Gosport', 'Hampshire'],
  ['Andover', 'Hampshire'],
  ['Havant', 'Hampshire'],
  ['Fleet', 'Hampshire'],

  // West Sussex
  ['Crawley', 'West Sussex'],
  ['Worthing', 'West Sussex'],
  ['Horsham', 'West Sussex'],
  ['Chichester', 'West Sussex'],
  ['Bognor Regis', 'West Sussex'],
  ['Haywards Heath', 'West Sussex'],
  ['East Grinstead', 'West Sussex'],
  ['Littlehampton', 'West Sussex'],

  // East Sussex
  ['Brighton', 'East Sussex'],
  ['Hove', 'East Sussex'],
  ['Eastbourne', 'East Sussex'],
  ['Hastings', 'East Sussex'],
  ['Lewes', 'East Sussex'],
  ['Bexhill-on-Sea', 'East Sussex'],
  ['Crowborough', 'East Sussex'],

  // West Midlands
  ['Birmingham', 'West Midlands'],
  ['Coventry', 'West Midlands'],
  ['Wolverhampton', 'West Midlands'],
  ['Solihull', 'West Midlands'],
  ['Dudley', 'West Midlands'],
  ['Walsall', 'West Midlands'],
  ['West Bromwich', 'West Midlands'],
  ['Sutton Coldfield', 'West Midlands'],
  ['Stourbridge', 'West Midlands'],
  ['Halesowen', 'West Midlands'],

  // Greater Manchester
  ['Manchester', 'Greater Manchester'],
  ['Salford', 'Greater Manchester'],
  ['Bolton', 'Greater Manchester'],
  ['Stockport', 'Greater Manchester'],
  ['Oldham', 'Greater Manchester'],
  ['Rochdale', 'Greater Manchester'],
  ['Bury', 'Greater Manchester'],
  ['Wigan', 'Greater Manchester'],
  ['Trafford', 'Greater Manchester'],
  ['Altrincham', 'Greater Manchester'],
  ['Ashton-under-Lyne', 'Greater Manchester'],
  ['Sale', 'Greater Manchester'],

  // Merseyside
  ['Liverpool', 'Merseyside'],
  ['Birkenhead', 'Merseyside'],
  ['St Helens', 'Merseyside'],
  ['Southport', 'Merseyside'],
  ['Bootle', 'Merseyside'],
  ['Wallasey', 'Merseyside'],

  // West Yorkshire
  ['Leeds', 'West Yorkshire'],
  ['Bradford', 'West Yorkshire'],
  ['Huddersfield', 'West Yorkshire'],
  ['Wakefield', 'West Yorkshire'],
  ['Halifax', 'West Yorkshire'],
  ['Keighley', 'West Yorkshire'],
  ['Dewsbury', 'West Yorkshire'],
  ['Batley', 'West Yorkshire'],
  ['Pudsey', 'West Yorkshire'],

  // South Yorkshire
  ['Sheffield', 'South Yorkshire'],
  ['Doncaster', 'South Yorkshire'],
  ['Rotherham', 'South Yorkshire'],
  ['Barnsley', 'South Yorkshire'],

  // North Yorkshire
  ['York', 'North Yorkshire'],
  ['Harrogate', 'North Yorkshire'],
  ['Scarborough', 'North Yorkshire'],
  ['Middlesbrough', 'North Yorkshire'],
  ['Northallerton', 'North Yorkshire'],
  ['Skipton', 'North Yorkshire'],

  // East Riding of Yorkshire
  ['Kingston upon Hull', 'East Riding of Yorkshire'],
  ['Beverley', 'East Riding of Yorkshire'],
  ['Bridlington', 'East Riding of Yorkshire'],
  ['Goole', 'East Riding of Yorkshire'],

  // Tyne and Wear
  ['Newcastle upon Tyne', 'Tyne and Wear'],
  ['Sunderland', 'Tyne and Wear'],
  ['Gateshead', 'Tyne and Wear'],
  ['South Shields', 'Tyne and Wear'],
  ['North Shields', 'Tyne and Wear'],
  ['Washington', 'Tyne and Wear'],
  ['Whitley Bay', 'Tyne and Wear'],

  // County Durham
  ['Durham', 'County Durham'],
  ['Darlington', 'County Durham'],
  ['Hartlepool', 'County Durham'],
  ['Stockton-on-Tees', 'County Durham'],
  ['Bishop Auckland', 'County Durham'],
  ['Chester-le-Street', 'County Durham'],

  // Northumberland
  ['Alnwick', 'Northumberland'],
  ['Hexham', 'Northumberland'],
  ['Morpeth', 'Northumberland'],
  ['Blyth', 'Northumberland'],
  ['Cramlington', 'Northumberland'],
  ['Berwick-upon-Tweed', 'Northumberland'],

  // Lancashire
  ['Preston', 'Lancashire'],
  ['Blackpool', 'Lancashire'],
  ['Blackburn', 'Lancashire'],
  ['Burnley', 'Lancashire'],
  ['Lancaster', 'Lancashire'],
  ['Chorley', 'Lancashire'],
  ['Accrington', 'Lancashire'],
  ['Nelson', 'Lancashire'],
  ['Skelmersdale', 'Lancashire'],
  ['Morecambe', 'Lancashire'],

  // Cheshire
  ['Chester', 'Cheshire'],
  ['Warrington', 'Cheshire'],
  ['Crewe', 'Cheshire'],
  ['Macclesfield', 'Cheshire'],
  ['Ellesmere Port', 'Cheshire'],
  ['Northwich', 'Cheshire'],
  ['Runcorn', 'Cheshire'],
  ['Widnes', 'Cheshire'],
  ['Wilmslow', 'Cheshire'],

  // Derbyshire
  ['Derby', 'Derbyshire'],
  ['Chesterfield', 'Derbyshire'],
  ['Buxton', 'Derbyshire'],
  ['Glossop', 'Derbyshire'],
  ['Ilkeston', 'Derbyshire'],
  ['Swadlincote', 'Derbyshire'],

  // Nottinghamshire
  ['Nottingham', 'Nottinghamshire'],
  ['Mansfield', 'Nottinghamshire'],
  ['Newark-on-Trent', 'Nottinghamshire'],
  ['Worksop', 'Nottinghamshire'],
  ['Beeston', 'Nottinghamshire'],

  // Leicestershire
  ['Leicester', 'Leicestershire'],
  ['Loughborough', 'Leicestershire'],
  ['Hinckley', 'Leicestershire'],
  ['Melton Mowbray', 'Leicestershire'],
  ['Coalville', 'Leicestershire'],

  // Lincolnshire
  ['Lincoln', 'Lincolnshire'],
  ['Grimsby', 'Lincolnshire'],
  ['Scunthorpe', 'Lincolnshire'],
  ['Boston', 'Lincolnshire'],
  ['Grantham', 'Lincolnshire'],
  ['Skegness', 'Lincolnshire'],
  ['Spalding', 'Lincolnshire'],

  // Staffordshire
  ['Stoke-on-Trent', 'Staffordshire'],
  ['Stafford', 'Staffordshire'],
  ['Burton upon Trent', 'Staffordshire'],
  ['Lichfield', 'Staffordshire'],
  ['Tamworth', 'Staffordshire'],
  ['Newcastle-under-Lyme', 'Staffordshire'],
  ['Cannock', 'Staffordshire'],

  // Shropshire
  ['Shrewsbury', 'Shropshire'],
  ['Telford', 'Shropshire'],
  ['Oswestry', 'Shropshire'],
  ['Bridgnorth', 'Shropshire'],

  // Worcestershire
  ['Worcester', 'Worcestershire'],
  ['Redditch', 'Worcestershire'],
  ['Kidderminster', 'Worcestershire'],
  ['Bromsgrove', 'Worcestershire'],
  ['Malvern', 'Worcestershire'],

  // Warwickshire
  ['Warwick', 'Warwickshire'],
  ['Leamington Spa', 'Warwickshire'],
  ['Nuneaton', 'Warwickshire'],
  ['Rugby', 'Warwickshire'],
  ['Stratford-upon-Avon', 'Warwickshire'],

  // Northamptonshire
  ['Northampton', 'Northamptonshire'],
  ['Kettering', 'Northamptonshire'],
  ['Corby', 'Northamptonshire'],
  ['Wellingborough', 'Northamptonshire'],
  ['Daventry', 'Northamptonshire'],

  // Cambridgeshire
  ['Cambridge', 'Cambridgeshire'],
  ['Peterborough', 'Cambridgeshire'],
  ['Huntingdon', 'Cambridgeshire'],
  ['St Neots', 'Cambridgeshire'],
  ['Wisbech', 'Cambridgeshire'],
  ['Ely', 'Cambridgeshire'],

  // Bedfordshire
  ['Luton', 'Bedfordshire'],
  ['Bedford', 'Bedfordshire'],
  ['Dunstable', 'Bedfordshire'],
  ['Leighton Buzzard', 'Bedfordshire'],
  ['Biggleswade', 'Bedfordshire'],

  // Norfolk
  ['Norwich', 'Norfolk'],
  ['Great Yarmouth', 'Norfolk'],
  ['King\u2019s Lynn', 'Norfolk'],
  ['Thetford', 'Norfolk'],
  ['Dereham', 'Norfolk'],

  // Suffolk
  ['Ipswich', 'Suffolk'],
  ['Bury St Edmunds', 'Suffolk'],
  ['Lowestoft', 'Suffolk'],
  ['Felixstowe', 'Suffolk'],
  ['Haverhill', 'Suffolk'],
  ['Newmarket', 'Suffolk'],

  // Gloucestershire
  ['Gloucester', 'Gloucestershire'],
  ['Cheltenham', 'Gloucestershire'],
  ['Stroud', 'Gloucestershire'],
  ['Cirencester', 'Gloucestershire'],
  ['Tewkesbury', 'Gloucestershire'],

  // Bristol
  ['Bristol', 'Bristol'],

  // Somerset
  ['Bath', 'Somerset'],
  ['Taunton', 'Somerset'],
  ['Weston-super-Mare', 'Somerset'],
  ['Yeovil', 'Somerset'],
  ['Bridgwater', 'Somerset'],
  ['Frome', 'Somerset'],
  ['Wells', 'Somerset'],

  // Wiltshire
  ['Swindon', 'Wiltshire'],
  ['Salisbury', 'Wiltshire'],
  ['Chippenham', 'Wiltshire'],
  ['Trowbridge', 'Wiltshire'],
  ['Devizes', 'Wiltshire'],

  // Dorset
  ['Bournemouth', 'Dorset'],
  ['Poole', 'Dorset'],
  ['Weymouth', 'Dorset'],
  ['Dorchester', 'Dorset'],
  ['Christchurch', 'Dorset'],

  // Devon
  ['Plymouth', 'Devon'],
  ['Exeter', 'Devon'],
  ['Torquay', 'Devon'],
  ['Paignton', 'Devon'],
  ['Barnstaple', 'Devon'],
  ['Newton Abbot', 'Devon'],
  ['Exmouth', 'Devon'],
  ['Tiverton', 'Devon'],

  // Cornwall
  ['Truro', 'Cornwall'],
  ['Falmouth', 'Cornwall'],
  ['Newquay', 'Cornwall'],
  ['St Austell', 'Cornwall'],
  ['Penzance', 'Cornwall'],
  ['Camborne', 'Cornwall'],
  ['Bodmin', 'Cornwall'],

  // Herefordshire
  ['Hereford', 'Herefordshire'],
  ['Leominster', 'Herefordshire'],
  ['Ross-on-Wye', 'Herefordshire'],

  // Cumbria
  ['Carlisle', 'Cumbria'],
  ['Barrow-in-Furness', 'Cumbria'],
  ['Kendal', 'Cumbria'],
  ['Whitehaven', 'Cumbria'],
  ['Workington', 'Cumbria'],
  ['Penrith', 'Cumbria'],

  // Rutland
  ['Oakham', 'Rutland'],

  // Isle of Wight
  ['Newport', 'Isle of Wight'],
  ['Ryde', 'Isle of Wight'],
  ['Cowes', 'Isle of Wight'],

  // ── Scotland ──
  ['Glasgow', 'Glasgow'],
  ['Edinburgh', 'Edinburgh'],
  ['Aberdeen', 'Aberdeenshire'],
  ['Dundee', 'Dundee'],
  ['Inverness', 'Highland'],
  ['Perth', 'Perth and Kinross'],
  ['Stirling', 'Stirlingshire'],
  ['Paisley', 'Renfrewshire'],
  ['East Kilbride', 'Lanarkshire'],
  ['Hamilton', 'Lanarkshire'],
  ['Motherwell', 'Lanarkshire'],
  ['Livingston', 'West Lothian'],
  ['Falkirk', 'Falkirk'],
  ['Ayr', 'Ayrshire'],
  ['Kilmarnock', 'Ayrshire'],
  ['Kirkcaldy', 'Fife'],
  ['Dunfermline', 'Fife'],
  ['St Andrews', 'Fife'],
  ['Greenock', 'Renfrewshire'],
  ['Dumfries', 'Dumfries and Galloway'],
  ['Elgin', 'Moray'],
  ['Oban', 'Argyll and Bute'],
  ['Fort William', 'Highland'],

  // ── Wales ──
  ['Cardiff', 'Cardiff'],
  ['Swansea', 'Swansea'],
  ['Newport', 'Newport'],
  ['Wrexham', 'Wrexham'],
  ['Bangor', 'Gwynedd'],
  ['Caernarfon', 'Gwynedd'],
  ['Aberystwyth', 'Ceredigion'],
  ['Llandudno', 'Conwy'],
  ['Rhyl', 'Denbighshire'],
  ['Bridgend', 'Bridgend'],
  ['Merthyr Tydfil', 'Merthyr Tydfil'],
  ['Pontypridd', 'Rhondda Cynon Taf'],
  ['Barry', 'Vale of Glamorgan'],
  ['Cwmbran', 'Torfaen'],
  ['Carmarthen', 'Carmarthenshire'],
  ['Haverfordwest', 'Pembrokeshire'],
  ['Neath', 'Neath Port Talbot'],
  ['Port Talbot', 'Neath Port Talbot'],
  ['Colwyn Bay', 'Conwy'],
  ['Mold', 'Flintshire'],

  // ── Northern Ireland ──
  ['Belfast', 'County Antrim'],
  ['Lisburn', 'County Antrim'],
  ['Ballymena', 'County Antrim'],
  ['Antrim', 'County Antrim'],
  ['Carrickfergus', 'County Antrim'],
  ['Londonderry', 'County Londonderry'],
  ['Coleraine', 'County Londonderry'],
  ['Newry', 'County Down'],
  ['Bangor', 'County Down'],
  ['Newtownards', 'County Down'],
  ['Downpatrick', 'County Down'],
  ['Armagh', 'County Armagh'],
  ['Portadown', 'County Armagh'],
  ['Lurgan', 'County Armagh'],
  ['Omagh', 'County Tyrone'],
  ['Dungannon', 'County Tyrone'],
  ['Strabane', 'County Tyrone'],
  ['Enniskillen', 'County Fermanagh'],
];

// Some names appear in more than one county (Newport, Bangor, Romford).
// The picker shows "Town, County" so the user disambiguates, and the stored
// county comes from the entry they chose - never from a name lookup.
var TOWNS = PLACES.map(function (p) {
  return { town: p[0], county: p[1], label: p[0] + ', ' + p[1] };
});

var COUNTIES = (function () {
  var seen = {};
  PLACES.forEach(function (p) { seen[p[1]] = true; });
  return Object.keys(seen).sort();
})();

// Only used to backfill areas that were typed before the picker existed.
// Ambiguous names deliberately resolve to null rather than guessing.
function countyForTown(name) {
  if (!name || typeof name !== 'string') return null;
  var needle = name.trim().toLowerCase();
  var hits = PLACES.filter(function (p) { return p[0].toLowerCase() === needle; });
  if (hits.length !== 1) return null;
  return hits[0][1];
}

module.exports = { TOWNS, COUNTIES, countyForTown };
