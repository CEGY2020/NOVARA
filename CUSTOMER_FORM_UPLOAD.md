# Customer form upload

Open **Upload Customer Forms** from Leads or Master Data Upload after deployment.

1. Choose a PDF, DOCX, XLSX, or CSV file (maximum 2 MB) and select **Read Form**. The portfolio review lists separate company, contact, site, pool, and contact-history records. Expand each record to review or edit it.
2. Review the extracted text and suggested labeled fields. Select the company and site when they already exist. Otherwise enter the company name, site name, street address, and city to create them.
3. Check contact details, notes, lead stage, and next follow-up. Remove notes belonging to other properties when the document contains several sites.
4. Check the review box and select **Save All Reviewed Records**. Up to 30 sites and 20 contacts can be saved together in one transaction (subject to total transaction size).
5. Use **Uploaded forms** to find and download the original document.

Blank contact fields preserve current values. Notes append to existing lead notes. The same file for the same site is skipped on retry. Ambiguous matches require an explicit selection. All record and document writes use one DynamoDB transaction.

## Deployment

Deploy the Lambda API with the updated requirements and `customer_forms.py`, then publish the static frontend files. The existing proxy route and Settings-table IAM permissions are used. No new AWS resources are required. The uploader requires an authenticated AEM account.

The source repository's existing deployment process remains authoritative. A frontend-only publication will display the page but imports will fail until the API update is deployed.

## Scope and verification

- Structured extraction recognizes the regional-contact/directory/site-savings PDF layout and labeled fields. Other layouts require manual entry in the review; there is no OCR or general-purpose AI extraction.
- Scanned PDFs can be attached with manually entered details.
- Pool area, count, evidence, and savings allowance are stored on site records. Estimated monthly and annual savings are recalculated from area / 800 × monthly allowance. Narrative older areas are not treated as current measurements.
- Corporate contacts are linked to the company; site contacts to the selected property. Office phones are separate from direct phones. A management-company record is not an owner record. Unconfirmed management remains a source association, not an assigned manager.
- View the company office/contact history and edit site pool fields and contact roles from Companies. Existing notes and unrelated metadata are preserved. Originals remain downloadable from Uploaded forms.
- Re-upload a previously notes-only document once to create its structured records. This does not delete prior notes or any incorrectly created site; those require a separate review. A structured retry of the same file/company is skipped.
- Original files are chunked into the existing Settings table and accessed through authenticated customer-form endpoints.
- Automated checks: `python -m unittest test_customer_forms.py`, Python compilation, and Node syntax checks. Tests use an in-memory transaction store and do not write to AWS. Production authentication, AWS transactions, and browser rendering still need a deployment smoke test.
