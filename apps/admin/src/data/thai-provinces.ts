// 77 Thai provinces with Flash Express default shipping days.
//
// `code` uses the short alpha codes already used elsewhere in the codebase
// (e.g. BKK, NBI, PTH in seed.ts and customer cart). These codes are the
// primary key for `shipping_days_<code>` system_config entries per issue #31.
//
// Flash Express default lead times (business days) follow their published
// coverage tiers:
//   * Bangkok + perimeter     -> 1 day
//   * Central / East / near   -> 2 days
//   * North / NE / South      -> 3 days
// Store owners can override any province via the System Config tab.

export interface ThaiProvince {
  code: string;
  nameEn: string;
  nameTh: string;
  flashDefaultDays: number;
}

export const THAI_PROVINCES: ThaiProvince[] = [
  // Tier 1 — Bangkok & perimeter (1 day)
  { code: 'BKK', nameEn: 'Bangkok', nameTh: 'กรุงเทพมหานคร', flashDefaultDays: 1 },
  { code: 'NBI', nameEn: 'Nonthaburi', nameTh: 'นนทบุรี', flashDefaultDays: 1 },
  { code: 'PTH', nameEn: 'Pathum Thani', nameTh: 'ปทุมธานี', flashDefaultDays: 1 },
  { code: 'SMK', nameEn: 'Samut Prakan', nameTh: 'สมุทรปราการ', flashDefaultDays: 1 },
  { code: 'SKN', nameEn: 'Samut Sakhon', nameTh: 'สมุทรสาคร', flashDefaultDays: 1 },
  { code: 'NPT', nameEn: 'Nakhon Pathom', nameTh: 'นครปฐม', flashDefaultDays: 1 },

  // Tier 2 — Central / East / near (2 days)
  { code: 'AYA', nameEn: 'Phra Nakhon Si Ayutthaya', nameTh: 'พระนครศรีอยุธยา', flashDefaultDays: 2 },
  { code: 'ATG', nameEn: 'Ang Thong', nameTh: 'อ่างทอง', flashDefaultDays: 2 },
  { code: 'CNT', nameEn: 'Chai Nat', nameTh: 'ชัยนาท', flashDefaultDays: 2 },
  { code: 'LRI', nameEn: 'Lopburi', nameTh: 'ลพบุรี', flashDefaultDays: 2 },
  { code: 'SBR', nameEn: 'Sing Buri', nameTh: 'สิงห์บุรี', flashDefaultDays: 2 },
  { code: 'SRB', nameEn: 'Saraburi', nameTh: 'สระบุรี', flashDefaultDays: 2 },
  { code: 'SPB', nameEn: 'Suphan Buri', nameTh: 'สุพรรณบุรี', flashDefaultDays: 2 },
  { code: 'NYK', nameEn: 'Nakhon Nayok', nameTh: 'นครนายก', flashDefaultDays: 2 },
  { code: 'SKM', nameEn: 'Samut Songkhram', nameTh: 'สมุทรสงคราม', flashDefaultDays: 2 },
  { code: 'KRI', nameEn: 'Kanchanaburi', nameTh: 'กาญจนบุรี', flashDefaultDays: 2 },
  { code: 'RBR', nameEn: 'Ratchaburi', nameTh: 'ราชบุรี', flashDefaultDays: 2 },
  { code: 'PBI', nameEn: 'Phetchaburi', nameTh: 'เพชรบุรี', flashDefaultDays: 2 },
  { code: 'PKN', nameEn: 'Prachuap Khiri Khan', nameTh: 'ประจวบคีรีขันธ์', flashDefaultDays: 2 },
  { code: 'CBI', nameEn: 'Chonburi', nameTh: 'ชลบุรี', flashDefaultDays: 2 },
  { code: 'RYG', nameEn: 'Rayong', nameTh: 'ระยอง', flashDefaultDays: 2 },
  { code: 'CTI', nameEn: 'Chanthaburi', nameTh: 'จันทบุรี', flashDefaultDays: 2 },
  { code: 'TRT', nameEn: 'Trat', nameTh: 'ตราด', flashDefaultDays: 2 },
  { code: 'CCO', nameEn: 'Chachoengsao', nameTh: 'ฉะเชิงเทรา', flashDefaultDays: 2 },
  { code: 'PRI', nameEn: 'Prachinburi', nameTh: 'ปราจีนบุรี', flashDefaultDays: 2 },
  { code: 'SKW', nameEn: 'Sa Kaeo', nameTh: 'สระแก้ว', flashDefaultDays: 2 },

  // Tier 3 — North (3 days)
  { code: 'CMI', nameEn: 'Chiang Mai', nameTh: 'เชียงใหม่', flashDefaultDays: 3 },
  { code: 'CRI', nameEn: 'Chiang Rai', nameTh: 'เชียงราย', flashDefaultDays: 3 },
  { code: 'LPG', nameEn: 'Lampang', nameTh: 'ลำปาง', flashDefaultDays: 3 },
  { code: 'LPN', nameEn: 'Lamphun', nameTh: 'ลำพูน', flashDefaultDays: 3 },
  { code: 'MSN', nameEn: 'Mae Hong Son', nameTh: 'แม่ฮ่องสอน', flashDefaultDays: 3 },
  { code: 'NAN', nameEn: 'Nan', nameTh: 'น่าน', flashDefaultDays: 3 },
  { code: 'PYO', nameEn: 'Phayao', nameTh: 'พะเยา', flashDefaultDays: 3 },
  { code: 'PRE', nameEn: 'Phrae', nameTh: 'แพร่', flashDefaultDays: 3 },
  { code: 'UTT', nameEn: 'Uttaradit', nameTh: 'อุตรดิตถ์', flashDefaultDays: 3 },
  { code: 'TAK', nameEn: 'Tak', nameTh: 'ตาก', flashDefaultDays: 3 },
  { code: 'PLK', nameEn: 'Phitsanulok', nameTh: 'พิษณุโลก', flashDefaultDays: 3 },
  { code: 'PCT', nameEn: 'Phichit', nameTh: 'พิจิตร', flashDefaultDays: 3 },
  { code: 'PNB', nameEn: 'Phetchabun', nameTh: 'เพชรบูรณ์', flashDefaultDays: 3 },
  { code: 'STI', nameEn: 'Sukhothai', nameTh: 'สุโขทัย', flashDefaultDays: 3 },
  { code: 'KPT', nameEn: 'Kamphaeng Phet', nameTh: 'กำแพงเพชร', flashDefaultDays: 3 },
  { code: 'NSN', nameEn: 'Nakhon Sawan', nameTh: 'นครสวรรค์', flashDefaultDays: 3 },
  { code: 'UTI', nameEn: 'Uthai Thani', nameTh: 'อุทัยธานี', flashDefaultDays: 3 },

  // Tier 3 — Northeast (Isan) (3 days)
  { code: 'NMA', nameEn: 'Nakhon Ratchasima', nameTh: 'นครราชสีมา', flashDefaultDays: 3 },
  { code: 'BRM', nameEn: 'Buriram', nameTh: 'บุรีรัมย์', flashDefaultDays: 3 },
  { code: 'SRN', nameEn: 'Surin', nameTh: 'สุรินทร์', flashDefaultDays: 3 },
  { code: 'SSK', nameEn: 'Si Sa Ket', nameTh: 'ศรีสะเกษ', flashDefaultDays: 3 },
  { code: 'UBN', nameEn: 'Ubon Ratchathani', nameTh: 'อุบลราชธานี', flashDefaultDays: 3 },
  { code: 'YST', nameEn: 'Yasothon', nameTh: 'ยโสธร', flashDefaultDays: 3 },
  { code: 'CPM', nameEn: 'Chaiyaphum', nameTh: 'ชัยภูมิ', flashDefaultDays: 3 },
  { code: 'ACR', nameEn: 'Amnat Charoen', nameTh: 'อำนาจเจริญ', flashDefaultDays: 3 },
  { code: 'NBP', nameEn: 'Nong Bua Lamphu', nameTh: 'หนองบัวลำภู', flashDefaultDays: 3 },
  { code: 'KKN', nameEn: 'Khon Kaen', nameTh: 'ขอนแก่น', flashDefaultDays: 3 },
  { code: 'UDN', nameEn: 'Udon Thani', nameTh: 'อุดรธานี', flashDefaultDays: 3 },
  { code: 'LEI', nameEn: 'Loei', nameTh: 'เลย', flashDefaultDays: 3 },
  { code: 'NKI', nameEn: 'Nong Khai', nameTh: 'หนองคาย', flashDefaultDays: 3 },
  { code: 'BKN', nameEn: 'Bueng Kan', nameTh: 'บึงกาฬ', flashDefaultDays: 3 },
  { code: 'MKM', nameEn: 'Maha Sarakham', nameTh: 'มหาสารคาม', flashDefaultDays: 3 },
  { code: 'RET', nameEn: 'Roi Et', nameTh: 'ร้อยเอ็ด', flashDefaultDays: 3 },
  { code: 'KSN', nameEn: 'Kalasin', nameTh: 'กาฬสินธุ์', flashDefaultDays: 3 },
  { code: 'SNK', nameEn: 'Sakon Nakhon', nameTh: 'สกลนคร', flashDefaultDays: 3 },
  { code: 'NPM', nameEn: 'Nakhon Phanom', nameTh: 'นครพนม', flashDefaultDays: 3 },
  { code: 'MDH', nameEn: 'Mukdahan', nameTh: 'มุกดาหาร', flashDefaultDays: 3 },

  // Tier 3 — South (3 days)
  { code: 'CPN', nameEn: 'Chumphon', nameTh: 'ชุมพร', flashDefaultDays: 3 },
  { code: 'RNG', nameEn: 'Ranong', nameTh: 'ระนอง', flashDefaultDays: 3 },
  { code: 'SNI', nameEn: 'Surat Thani', nameTh: 'สุราษฎร์ธานี', flashDefaultDays: 3 },
  { code: 'PNA', nameEn: 'Phang Nga', nameTh: 'พังงา', flashDefaultDays: 3 },
  { code: 'PKT', nameEn: 'Phuket', nameTh: 'ภูเก็ต', flashDefaultDays: 3 },
  { code: 'KBI', nameEn: 'Krabi', nameTh: 'กระบี่', flashDefaultDays: 3 },
  { code: 'NST', nameEn: 'Nakhon Si Thammarat', nameTh: 'นครศรีธรรมราช', flashDefaultDays: 3 },
  { code: 'PLG', nameEn: 'Phatthalung', nameTh: 'พัทลุง', flashDefaultDays: 3 },
  { code: 'TRG', nameEn: 'Trang', nameTh: 'ตรัง', flashDefaultDays: 3 },
  { code: 'STN', nameEn: 'Satun', nameTh: 'สตูล', flashDefaultDays: 3 },
  { code: 'SKA', nameEn: 'Songkhla', nameTh: 'สงขลา', flashDefaultDays: 3 },
  { code: 'PTN', nameEn: 'Pattani', nameTh: 'ปัตตานี', flashDefaultDays: 3 },
  { code: 'YLA', nameEn: 'Yala', nameTh: 'ยะลา', flashDefaultDays: 3 },
  { code: 'NWT', nameEn: 'Narathiwat', nameTh: 'นราธิวาส', flashDefaultDays: 3 },
];

export const PROVINCE_CODES = THAI_PROVINCES.map((p) => p.code);
