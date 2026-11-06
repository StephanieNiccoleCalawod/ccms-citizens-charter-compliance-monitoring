// Only display dates backed by a nationwide proclamation. Nager's Public label cannot classify them.
// Extend this list when a new proclamation is published. Local holidays and special working days are excluded.
const regular = 'REGULAR_HOLIDAY';
const special = 'SPECIAL_NON_WORKING';

export const PHILIPPINE_HOLIDAYS = {
  // https://lawphil.net/executive/proc/proc2025/proc_1006_2025.html
  // https://pco.gov.ph/news_releases/palace-declares-march-20-regular-holiday-nationwide-for-eidl-fitr/
  // https://pco.gov.ph/news_releases/palace-declares-may-27-as-a-regular-holiday-for-eidl-adha-observance/
  2026: [
    ['01-01', regular, "New Year's Day"],
    ['02-17', special, 'Chinese New Year'],
    ['03-20', regular, 'Eid’l Fitr'],
    ['04-02', regular, 'Maundy Thursday'],
    ['04-03', regular, 'Good Friday'],
    ['04-04', special, 'Black Saturday'],
    ['04-09', regular, 'Day of Valor'],
    ['05-01', regular, 'Labor Day'],
    ['05-27', regular, 'Eid’l Adha'],
    ['06-12', regular, 'Independence Day'],
    ['08-21', special, 'Ninoy Aquino Day'],
    ['08-31', regular, 'National Heroes Day'],
    ['11-01', special, "All Saints' Day"],
    ['11-02', special, "All Souls' Day"],
    ['11-30', regular, 'Bonifacio Day'],
    ['12-08', special, 'Feast of the Immaculate Conception'],
    ['12-24', special, 'Christmas Eve'],
    ['12-25', regular, 'Christmas Day'],
    ['12-30', regular, 'Rizal Day'],
    ['12-31', special, 'Last Day of the Year'],
  ],
  // https://www.lawphil.net/executive/proc/proc2026/proc_1427_2026.html
  2027: [
    ['01-01', regular, "New Year's Day"],
    ['02-06', special, 'Chinese New Year'],
    ['03-25', regular, 'Maundy Thursday'],
    ['03-26', regular, 'Good Friday'],
    ['03-27', special, 'Black Saturday'],
    ['04-09', regular, 'Day of Valor'],
    ['05-01', regular, 'Labor Day'],
    ['06-12', regular, 'Independence Day'],
    ['08-21', special, 'Ninoy Aquino Day'],
    ['08-30', regular, 'National Heroes Day'],
    ['11-01', special, "All Saints' Day"],
    ['11-02', special, "All Souls' Day"],
    ['11-30', regular, 'Bonifacio Day'],
    ['12-08', special, 'Feast of the Immaculate Conception'],
    ['12-24', special, 'Christmas Eve'],
    ['12-25', regular, 'Christmas Day'],
    ['12-30', regular, 'Rizal Day'],
    ['12-31', special, 'Last Day of the Year'],
  ],
};
