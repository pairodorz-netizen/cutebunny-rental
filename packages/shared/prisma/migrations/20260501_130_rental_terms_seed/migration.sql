-- Seed the rental_terms system config so the customer checkout page
-- displays editable terms from the database instead of hardcoded text.
INSERT INTO "system_configs" (id, key, value, label, "group")
VALUES (
  uuid_generate_v4(),
  'rental_terms',
  '"เงื่อนไขการเช่าชุด CuteBunny Rental:\n1. ลูกค้าต้องวางมัดจำตามจำนวนที่กำหนดก่อนรับชุด\n2. หากชุดเสียหายหรือสูญหาย ลูกค้าต้องรับผิดชอบค่าเสียหายตามราคาที่กำหนด\n3. ต้องส่งคืนชุดภายในวันที่กำหนด หากส่งคืนล่าช้าจะมีค่าปรับรายวัน\n4. ลูกค้าต้องแนบสำเนาบัตรประชาชนและ/หรือหน้า Social Media เพื่อยืนยันตัวตน\n5. ชุดที่เช่าต้องซักแห้งก่อนส่งคืน หรือชำระค่าซักเพิ่มเติม\n6. การยกเลิกคำสั่งเช่าหลังจากชำระเงินแล้ว จะหักค่าธรรมเนียม 20%\n7. CuteBunny Rental ขอสงวนสิทธิ์ในการปฏิเสธการให้เช่าหากพิจารณาแล้วเห็นว่าไม่เหมาะสม"',
  'Rental Terms',
  'customer_ux'
)
ON CONFLICT (key) DO NOTHING;
