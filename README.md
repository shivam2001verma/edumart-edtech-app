# EduMart — Full-Stack Ed-Tech Application

A full-stack Ed-Tech study material store where students can browse CBSE study materials by **Board → Class → Subject → Chapter**, purchase individual chapters, subject packs (with automatic upgrade credit for owned chapters), or time-bound class passes (30-day Monthly / 365-day Annual), apply coupons, view 18% GST splits, and unlock access via Razorpay Checkout & Webhooks.

## Setup & Running Locally
1. **Database Setup:** Run `database/assessment_upgrade.sql` and `database/seed.sql` in MySQL Workbench.
2. **Backend:** `cd server && cp .env.example .env && npm install && npm run dev`
3. **Frontend:** `cd client && npm install && npm run dev`

## Seed Accounts
- **Admin:** `admin@edumart.test` / `password123`
- **Student:** `student@edumart.test` / `password123`

## ER Diagram
users 1---* orders 1---* order_items *---1 products 1---* prices
  |           +---* payments
  +---* entitlements (scope_type: chapter | subject | class, expires_at)
boards 1---* classes 1---* subjects 1---* chapters 1---* materials