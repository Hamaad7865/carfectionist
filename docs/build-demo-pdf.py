"""Builds docs/HAZ-Software-Demo.pdf — the prospect-facing demo guide.
Run:  python docs/build-demo-pdf.py
"""
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import Paragraph

pdfmetrics.registerFont(TTFont("C", "C:/Windows/Fonts/calibri.ttf"))
pdfmetrics.registerFont(TTFont("CB", "C:/Windows/Fonts/calibrib.ttf"))

BLUE = HexColor("#2b6bff")
DEEP = HexColor("#0f2a6b")
INK = HexColor("#0f1720")
MUTED = HexColor("#5b6b7e")
LINE = HexColor("#dfe6f0")
TINT = HexColor("#eef3ff")
W, H = A4
M = 46

out = Path(__file__).resolve().parent / "HAZ-Software-Demo.pdf"
c = canvas.Canvas(str(out), pagesize=A4)
c.setTitle("HAZ Software - Demo Guide")
c.setAuthor("HAZ Software")


def para(text, x, y, w, size=11, color=INK):
    st = ParagraphStyle("p", fontName="C", fontSize=size, leading=size * 1.38, textColor=color)
    p = Paragraph(text, st)
    _, h = p.wrap(w, 1000)
    p.drawOn(c, x, y - h)
    return y - h


def footer(n):
    c.setFont("C", 8.5)
    c.setFillColor(MUTED)
    c.drawString(M, 26, "HAZ Software \u00b7 Mauritius")
    c.drawRightString(W - M, 26, str(n))


def wordmark(x, y, size=22, col=white):
    c.setFillColor(col)
    c.setFont("CB", size)
    c.drawString(x, y, "HAZ")
    c.setFont("C", size)
    c.drawString(x + size * 1.95, y, "Software")


# ---- page 1: cover -------------------------------------------------------
c.setFillColor(DEEP)
c.rect(0, H - 330, W, 330, fill=1, stroke=0)
c.setFillColor(BLUE)
c.rect(0, H - 330, W * 0.36, 8, fill=1, stroke=0)
wordmark(M, H - 70, 26)
c.setFillColor(white)
c.setFont("CB", 38)
c.drawString(M, H - 170, "Run your whole shop")
c.drawString(M, H - 214, "from one system.")
c.setFont("C", 14)
c.setFillColor(HexColor("#c8d6ff"))
c.drawString(M, H - 252, "Point of sale, stock, jobs and invoicing \u2014 built for car-care and")
c.drawString(M, H - 271, "retail businesses in Mauritius.")

y = H - 380
c.setFont("CB", 20)
c.setFillColor(INK)
c.drawString(M, y, "Try it yourself")
y = para(
    "A ready-made sample company, <b>HAZ Demo Auto Care</b>, is set up with customers, cars, products, "
    "quotes, invoices and payments. Everything in it is invented \u2014 click anything you like.",
    M, y - 12, W - 2 * M, 12.5, MUTED,
)
by = y - 28
c.setFillColor(TINT)
c.setStrokeColor(LINE)
c.roundRect(M, by - 128, W - 2 * M, 128, 10, fill=1, stroke=1)
ry = by - 30
for k, v in [("Address", "https://app.hazsoftware.com"),
             ("Email", "owner@demo.hazsoftware.test"),
             ("Password", "DemoHAZ-2026")]:
    c.setFont("C", 11)
    c.setFillColor(MUTED)
    c.drawString(M + 22, ry, k.upper())
    c.setFont("CB", 15)
    c.setFillColor(INK)
    c.drawString(M + 120, ry - 1, v)
    ry -= 34
c.setFont("C", 10.5)
c.setFillColor(MUTED)
c.drawString(M, by - 152, "Works in any web browser on a computer, tablet or phone. No installation needed.")

y = by - 200
c.setFont("CB", 20)
c.setFillColor(INK)
c.drawString(M, y, "At a glance")
stats = [("12", "services"), ("22", "products"), ("10", "customers"), ("50+", "sample bills & quotes")]
cw = (W - 2 * M - 3 * 12) / 4
for i, (n, label) in enumerate(stats):
    x = M + i * (cw + 12)
    c.setFillColor(white)
    c.setStrokeColor(LINE)
    c.roundRect(x, y - 92, cw, 68, 9, fill=1, stroke=1)
    c.setFillColor(BLUE)
    c.setFont("CB", 26)
    c.drawString(x + 14, y - 58, n)
    c.setFillColor(MUTED)
    c.setFont("C", 11)
    c.drawString(x + 14, y - 78, label)
footer(1)
c.showPage()

# ---- page 2: what it does ------------------------------------------------
wordmark(M, H - 50, 17, DEEP)
c.setFont("CB", 26)
c.setFillColor(INK)
c.drawString(M, H - 100, "What the system does")
cards = [
    ("Quotes and invoices", "Professional A4 documents with the VAT breakdown, numbered automatically with no gaps. Send by email or WhatsApp in one click."),
    ("Point of sale", "Ring up sales fast. Take cash, card, Juice, bank transfer, cheque or loyalty points \u2014 or split one bill across several."),
    ("Stock control", "Shop and warehouse counts, low-stock alerts, and a full history of every movement so any number can be explained."),
    ("Jobs and services", "An accepted quote becomes a job on the board, tied to the customer's vehicle and its history."),
    ("Customers and fleets", "Every customer with their cars, balances and loyalty points. Fleet and company accounts with many vehicles."),
    ("Reports and accounts", "Daily sales by payment method, till sessions and Z-reports, unpaid balances, and CSV exports for your accountant."),
    ("Control and safety", "Owner, manager and cashier roles. Issued invoices are locked and every change leaves an audit trail."),
    ("Tablet till", "A companion Android tablet point of sale that keeps selling without internet and syncs when it reconnects."),
]
cw = (W - 2 * M - 14) / 2
ch = 150
top = H - 130
for i, (t, d) in enumerate(cards):
    x = M + (i % 2) * (cw + 14)
    yy = top - (i // 2) * (ch + 12)
    c.setFillColor(white)
    c.setStrokeColor(LINE)
    c.roundRect(x, yy - ch, cw, ch, 10, fill=1, stroke=1)
    c.setFillColor(BLUE)
    c.roundRect(x + 16, yy - 36, 28, 28, 7, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("CB", 14)
    c.drawCentredString(x + 30, yy - 27, str(i + 1))
    c.setFillColor(INK)
    c.setFont("CB", 14)
    c.drawString(x + 54, yy - 28, t)
    para(d, x + 16, yy - 52, cw - 32, 11, MUTED)
footer(2)
c.showPage()

# ---- page 3: tour --------------------------------------------------------
wordmark(M, H - 50, 17, DEEP)
c.setFont("CB", 26)
c.setFillColor(INK)
c.drawString(M, H - 100, "A 10-minute tour")
para("Sign in, then follow these steps to see a typical day in the shop.", M, H - 112, W - 2 * M, 12.5, MUTED)
steps = [
    ("Customers and vehicles", "Open <b>Coastal Rentals Ltd</b> to see a fleet account with several cars under one customer."),
    ("Quotes", "Open any quotation. See the 15% VAT worked out, then send it by email or WhatsApp. In this demo, messages go to the demo owner only \u2014 never to a real customer."),
    ("Quote to job", "A quote with a service on it becomes a job on the job board, linked to the car."),
    ("Invoices and payments", "Open an invoice and take a payment by cash, card or Juice, or part-pay it and leave a balance."),
    ("Stock", "Check the Shop and Warehouse counts. Sales reduce stock, and every change is recorded."),
    ("Sales journal and reports", "See the day's sales grouped by payment method, with the bills under each. Export to CSV."),
    ("Print a document", "Open any invoice and download the A4 PDF \u2014 ready to hand to a customer."),
]
y = H - 160
for i, (t, d) in enumerate(steps):
    c.setFillColor(BLUE)
    c.circle(M + 14, y - 12, 13, fill=1, stroke=0)
    c.setFillColor(white)
    c.setFont("CB", 13)
    c.drawCentredString(M + 14, y - 17, str(i + 1))
    c.setFillColor(INK)
    c.setFont("CB", 14)
    c.drawString(M + 40, y - 8, t)
    end = para(d, M + 40, y - 14, W - 2 * M - 40, 11.5, MUTED)
    y = end - 18
y -= 6
c.setFillColor(TINT)
c.setStrokeColor(LINE)
c.roundRect(M, y - 98, W - 2 * M, 98, 10, fill=1, stroke=1)
c.setFillColor(DEEP)
c.setFont("CB", 14)
c.drawString(M + 20, y - 28, "Good to know")
para(
    "Prices in the demo exclude 15% VAT. The sample trading is dated today, so reports show a single day. "
    "We would love to hear what you would change \u2014 the system is built around how your shop actually works.",
    M + 20, y - 38, W - 2 * M - 40, 11, INK,
)
footer(3)
c.showPage()
c.save()
print("wrote", out)
