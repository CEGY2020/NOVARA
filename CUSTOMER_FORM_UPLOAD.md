# Customer form upload

Open **Upload Customer Forms** from Leads or Master Data Upload after deployment.

1. Choose a PDF, DOCX, XLSX, or CSV file (maximum 2 MB) and select **Read Form**.
2. Review the extracted text and suggested labeled fields. Select the company and site when they already exist. Otherwise enter the company name, site name, street address, and city to create them.
3. Check contact details, notes, lead stage, and next follow-up. Remove notes belonging to other properties when the document contains several sites.
4. Check the review box and select **Save Customer and Form**. Repeat for each additional site in a multi-site document.
5. Use **Uploaded forms** to find and download the original document.

Blank contact fields preserve current values. Notes append to existing lead notes. The same file for the same site is skipped on retry. Ambiguous matches require an explicit selection. All record and document writes use one DynamoDB transaction.

## Deployment

Deploy the Lambda API with the updated requirements and `customer_forms.py`, then publish the static frontend files. The existing proxy route and Settings-table IAM permissions are used. No new AWS resources are required. The uploader requires an authenticated AEM account.

The source repository's existing deployment process remains authoritative. A frontend-only publication will display the page but imports will fail until the API update is deployed.

## Scope and verification

- Label-based suggestions, with manual review; no OCR or automatic multi-site splitting.
- Scanned PDFs can be attached with manually entered details.
- Pool dimensions and maintenance-engineer details can be retained in notes; this version does not calculate pool areas.
- Original files are chunked into the existing Settings table and accessed through authenticated customer-form endpoints.
- Automated checks: `python -m unittest test_customer_forms.py`, Python compilation, and Node syntax checks. Tests use an in-memory transaction store and do not write to AWS. Production authentication, AWS transactions, and browser rendering still need a deployment smoke test.
