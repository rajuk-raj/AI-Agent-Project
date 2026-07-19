"""
Generates a realistic PDF resume fixture for testing the PDF parser.

Writes a genuine multi-line, multi-font PDF with bullet glyphs and indentation
-- the layout characteristics that break naive text extraction. Dev-only.

Usage:  python scripts/make_test_pdf.py
"""

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "test" / "fixtures" / "sample-resume.pdf"

try:
    from reportlab.lib.pagesizes import LETTER
    from reportlab.pdfgen import canvas
except ImportError:
    sys.exit("reportlab not installed. Run:  python -m pip install reportlab")

LEFT = 54
BULLET_INDENT = 68
TOP = 750


def main():
    OUT.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(OUT), pagesize=LETTER)
    y = TOP

    def line(text, size=9.5, font="Helvetica", x=LEFT, gap=14):
        nonlocal y
        c.setFont(font, size)
        c.drawString(x, y, text)
        y -= gap

    def bullet(text):
        nonlocal y
        # Bullet glyph and text drawn as separate runs at different x positions
        # -- exactly the case that must not collapse into the previous line.
        c.setFont("Helvetica", 9.5)
        c.drawString(BULLET_INDENT, y, "•")
        c.drawString(BULLET_INDENT + 10, y, text)
        y -= 13

    line("PRIYA RAMANATHAN", size=15, font="Helvetica-Bold", gap=16)
    line("Bengaluru, India  |  priya.r@example.com  |  linkedin.com/in/example", size=8.5, gap=22)

    line("EXPERIENCE", size=10.5, font="Helvetica-Bold", gap=16)

    line("Senior Product Manager, Pine Labs", size=10, font="Helvetica-Bold", gap=12)
    line("Mar 2023 - Present", size=8.5, font="Helvetica-Oblique", gap=14)
    bullet("Responsible for the merchant onboarding product area and its roadmap")
    bullet("Cut merchant onboarding drop-off from 41% to 23% by removing two redundant KYC steps")
    bullet("Improved the onboarding flow based on feedback from the sales team")
    bullet("Ran 18 merchant interviews to identify why mid-market signups stalled, which redirected the Q3 roadmap")
    bullet("Worked on the payments retry logic with engineering")
    bullet("Launched a self-serve settlement dashboard used by 4,200 merchants in the first quarter")
    y -= 8

    line("Product Manager, Razorpay", size=10, font="Helvetica-Bold", gap=12)
    line("Jun 2021 - Feb 2023", size=8.5, font="Helvetica-Oblique", gap=14)
    bullet("Managed the disputes and chargeback experience")
    bullet("Shipped an automated evidence-collection flow that reduced manual dispute handling time by 60%")
    bullet("Helped the engineering team with sprint planning and backlog grooming")
    bullet("Defined the dispute resolution SLA metric and drove it from 9 days to 4 days")
    bullet("Presented the quarterly disputes review to the leadership team")
    y -= 8

    line("Associate Product Manager, Freshworks", size=10, font="Helvetica-Bold", gap=12)
    line("Jul 2019 - May 2021", size=8.5, font="Helvetica-Oblique", gap=14)
    bullet("Assisted with the CRM mobile app release")
    bullet("Built an internal tool that let support agents resolve tickets without escalating to engineering")
    bullet("Participated in user research sessions")
    y -= 12

    line("SKILLS", size=10.5, font="Helvetica-Bold", gap=14)
    line("SQL, Amplitude, Figma, Jira, A/B testing, roadmapping", gap=20)

    line("EDUCATION", size=10.5, font="Helvetica-Bold", gap=14)
    line("B.Tech, Computer Science - Anna University, 2019")

    c.save()
    print(f"Wrote {OUT.relative_to(ROOT)} ({OUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
