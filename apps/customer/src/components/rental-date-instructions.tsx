'use client';

import { CalendarDays } from 'lucide-react';

/**
 * Static, non-interactive info box explaining how to choose rental dates.
 * Placed between the availability calendar and the booking summary on the
 * product detail page. Styled to match the delivery-method card aesthetic
 * (rounded-2xl, border, same padding/spacing) but without any clickable,
 * hover, or active states.
 */
export function RentalDateInstructions() {
  return (
    <div className="rounded-2xl border-2 border-border bg-white p-4 space-y-3">
      {/* Title */}
      <div className="flex items-center gap-2">
        <CalendarDays className="h-5 w-5 text-cb-active shrink-0" />
        <h3 className="text-sm font-semibold text-cb-heading">
          วิธีการเลือกวันเช่าชุด
        </h3>
      </div>

      {/* Body */}
      <div className="text-xs leading-relaxed text-muted-foreground space-y-2.5">
        <p>
          1.เลือกวันใช้ชุด โดยกดเฉพาะวันที่เริ่มใช้ชุด
          และวันสิ้นสุดการใช้ชุด (ไม่รวมวันจัดส่ง) เช่น
          ลูกค้าจะเช่า 3 วัน ใช้ชุดวันที่ 5-7 ให้เลือก 5 กับ 7
        </p>

        <p>
          2.กรณีที่ลูกค้าเลือกวิธีจัดส่งปกติ(ขนส่ง)
          ควรเผื่อเวลาจัดส่งทั้ง &quot;ก่อน&quot; และ
          &quot;หลัง&quot; วันใช้งานดังนี้..
        </p>
        <ul className="list-disc list-outside ml-4 space-y-1">
          <li>
            หากลูกค้าอยู่ในจังหวัดกทม.-ปริมณฑล
            ควรเว้นว่างช่องสีเขียวไว้ 2
            วันทั้งก่อนหน้าและหลังการใช้งาน (รวมวันถึง)
          </li>
          <li>
            หากลูกค้าอยู่ต่างจังหวัด(ไม่ใช่กทม.-ปริมณฑล)
            ควรเว้นว่างช่องสีเขียวไว้ขั้นต่ำ 3 วัน
            โดยทางร้านจัดส่งโดยใช้ Flash Express
          </li>
        </ul>
        <p>
          📌หรือหากลูกค้าไม่มั่นใจในการเลือกวันสามารถสอบถามแอดมินได้
        </p>

        <p>
          ยกตัวอย่างเช่น ลูกค้าอยู่กทม.
          ต้องการเช่าชุดวันที่ 5-7 ให้เลือกหมายเลข 5 กับ 7
          และเว้นว่างช่องสีเขียวในวันที่ 3-4 และ 8-9 ตามลำดับ
        </p>
        <p className="font-medium text-cb-heading">
          (ทั้งนี้ร้านจะจัดส่งของถึงลูกค้าไม่เกินวันที่ 4
          และลูกค้าส่งคืนร้านในวันที่ 8)
        </p>

        <p>
          3.หากวันใช้ชุดชิดกับคิวก่อนหน้า ไม่สามารถเว้นว่างได้
          ลูกค้าสามารถเลือกวิธีจัดส่งเป็นแมสได้🛵(ลูกค้าต้องออกค่าแมสเอง)
          กรณีที่เช่ามากกว่า 1
          วันสามารถส่งกลับเป็นขนส่งตามกฎของร้านได้
          (เหมาะกับลูกค้าโซนกรุงเทพและปริมณฑล)
        </p>

        <p>
          4.หากวันใช้ชุดชิดกับคิวถัดไป
          ต้องส่งกลับด้วยวิธีแมส🛵ก่อน 12:00น. ของวันถัดไป
          ลูกค้าออกค่าส่งเอง และต้องเว้นช่องเขียว 1 วัน
          (ให้ทางร้านคลีนชุด)
          ทั้งนี้เมื่อเช่าสำเร็จลูกค้าต้องแคปหลักฐานยืนยันกับแอดมินผ่าน
          Line OA ด้วย
        </p>

        <p>
          5.หากลูกค้าอยู่ต่างจังหวัด
          (ไม่ใช่โซนกทม.-ปริมณฑล)
          แล้ววันใช้ชุดชิดกับคิวก่อนหน้าหรือคิวถัดไป
          จะถือว่าคิวไม่ว่าง ให้ลูกค้าเลือกชุดอื่นแทน
        </p>
      </div>
    </div>
  );
}
