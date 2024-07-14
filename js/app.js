/*!
 * © 2024 Julian Davis of xai.com.au
 * This code is open source.
 */

/**
 * @file app.js
 * @description This JavaScript file handles the fetching, processing, and downloading
 *              of xAPI statements from a Learning Record Store (LRS). It includes functions
 *              to update progress bars, display messages, test connections, obfuscate emails,
 *              and format data into CSV, JSONL, or raw JSON formats for download.
 * @version 1.0.0
 * @date 2024-07-15
 * @author Julian Davis
 * @license MIT
 *
 * @dependencies
 * - jQuery (https://jquery.com/)
 * - xAPI Wrapper (https://github.com/adlnet/xAPIWrapper)
 *
 * @usage
 * - Ensure jQuery and xAPI Wrapper are included in your project.
 * - Customize the HTML elements' IDs in the code if needed.
 * - Modify the endpoint, client, and secret values for your LRS.
 *
 * @example
 * <script src="path/to/jquery.min.js"></script>
 * <script src="path/to/xAPIWrapper.min.js"></script>
 * <script src="app.js"></script>
 */


$(document).ready(function() {
    // Initialize the fetching flag
    let isFetching = true;

    // Set the default date for the dateUntil input field to the current date
    document.getElementById('dateUntil').valueAsDate = new Date();

    // Function to update the progress bar with current percentage, count, and total count
    const updateProgressBar = (percentage, currentCount, totalCount) => {
        $('#progressBar').css('width', `${percentage}%`).attr('aria-valuenow', percentage);
        $('#progressBar').text(`${currentCount} / ${totalCount}`);
    };

    // Function to display a message in a specified alert type
    const showMessage = (message, type) => {
        const alertClass = `alert alert-${type}`;
        $('#alertMessage').html(`<div class="${alertClass}" role="alert">${message}</div>`);
    };

    // Function to get the current timestamp in YYYYMMDD_HHMMSS format
    const getCurrentTimestamp = () => {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        return `${year}${month}${day}_${hours}${minutes}${seconds}`;
    };

    // Function to extract the domain from a URL
    const getDomainFromUrl = (url) => {
        const a = document.createElement('a');
        a.href = url;
        return a.hostname;
    };

    // Function to enable or disable form inputs
    const disableForm = (disable) => {
        $('#queryForm :input').prop('disabled', disable);
        $('#stopButton').prop('disabled', !disable);
    };

    // Function to test the connection to the Learning Record Store
    const testConnection = async (config) => {
        return new Promise((resolve, reject) => {
            try {
                ADL.XAPIWrapper.changeConfig(config);
                ADL.XAPIWrapper.getStatements({ limit: 1 }, null, (res) => {
                    if (res.status !== 200) {
                        reject('Error connecting to the Learning Record Store.');
                    } else {
                        resolve();
                    }
                });
            } catch (error) {
                reject(`Error in testConnection: ${error.message}`);
            }
        });
    };

    // Function to obfuscate email addresses
    function obfuscateEmail(email) {
        const [localPart, domain] = email.split('@');
        const obfuscatedLocalPart = localPart.charAt(0) + '*'.repeat(localPart.length - 1);
        return `${obfuscatedLocalPart}@${domain}`;
    }

    // Function to extract name from JSON string
    function extractName(jsonString) {
        const data = JSON.parse(jsonString);
        if (data.name) {
            return data.name;
        } else if (data.account && data.account.name) {
            return data.account.name;
        } else {
            return null; // Return null if no name is found
        }
    }

    // Function to convert ISO 8601 duration to seconds
    function iso8601ToSeconds(duration) {
        const pattern = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)(\.\d+)?S)?$/;
        const matches = duration.match(pattern);
        if (matches) {
            const hours = matches[1] ? parseInt(matches[1]) : 0;
            const minutes = matches[2] ? parseInt(matches[2]) : 0;
            const seconds = matches[3] ? parseInt(matches[3]) : 0;
            const fractional = matches[4] ? parseFloat(matches[4]) : 0.0;
            const totalSeconds = hours * 3600 + minutes * 60 + seconds + fractional;
            return totalSeconds;
        } else {
            return ""; // Return empty string for invalid format
        }
    }

    // Function to process a string to an array
    function processStringToArray(inputString) {
        let trimmedString = inputString.trim().replace(/^\[|\]$/g, '');
        trimmedString = trimmedString.replace(/^"|"$/g, '');
        const array = trimmedString.split('[,]');
        return array;
    }

    // Function to fetch xAPI statements
    const fetchStatements = async (config, query) => {
        let allStatements = [];
        let more = null;
        let fetchedCount = 0;

        // Recursive fetch function
        const fetch = () => {
            if (!isFetching || fetchedCount >= query['limit']) return Promise.resolve(allStatements);

            return new Promise((resolve, reject) => {
                ADL.XAPIWrapper.getStatements(query, more, (res) => {
                    if (res.status !== 200) {
                        reject('Error fetching statements.');
                        return;
                    }

                    const response = JSON.parse(res.response);
                    if (!response.statements) {
                        reject('No statements found.');
                        return;
                    }

                    const filteredStatements = response.statements.filter(s => s.actor && s.actor.mbox && s.verb && s.verb.display);
                    allStatements = allStatements.concat(filteredStatements);
                    fetchedCount += filteredStatements.length;

                    if (response.more && response.more !== "" && isFetching) {
                        more = response.more;
                        fetch().then(resolve).catch(reject);
                    } else {
                        resolve(allStatements);
                    }

                    const totalCount = parseInt(query.limit);
                    const currentCount = allStatements.length;
                    const percentage = (currentCount / totalCount) * 100;
                    updateProgressBar(percentage, currentCount, totalCount);
                });
            });
        };

        return fetch();
    };

    // Function to process and download statements
    const processStatements = (statements, format, endpoint) => {
        let data, mimeType, extension;
        const obfuscateCheckbox = document.getElementById('obfuscateCheckbox').checked;

        switch (format) {
            case 'csv':
                data = "ID,Actor,Verb,ObjectID,Object,Duration,Question Answers,Question Passed,Question Correct Answers,Users Answer,Timestamp\\n" +
                statements.map((s, index) => {
                    const id = s.id;
                    var actor = "";
                    
                    if (obfuscateCheckbox) {
                        actor = s.actor.mbox ? obfuscateEmail(s.actor.mbox.replace('mailto:', '')) : '';
                    } else {
                        actor = s.actor.mbox ? s.actor.mbox.replace('mailto:', '') : '';
                    }

                    const verb = s.verb.display ? Object.values(s.verb.display)[0] : '';
                    const objectName = s.object.definition && s.object.definition.name ? Object.values(s.object.definition.name)[0] : '';
                    const objectId = s.object.id;
                    const timestamp = s.timestamp;

                    let duration = "0";
                    try {
                        if (s.result && s.result.duration) {
                            duration = iso8601ToSeconds(s.result.duration);
                        }
                    } catch (ex) {
                        duration = ex.message;
                    }

                    let questionAnswers = "";
                    let questionPassed = "";
                    let questionCorrectAnswers = "";
                    let usersAnswer = "";

                    if (s.result && s.result.response) {
                        const res = JSON.parse(s.result.response);
                        questionPassed = res.success ? 'True' : 'False';
                        let i = 1;
                        JSON.parse(s.result.choices).forEach(choice => {
                            questionAnswers += `id= ${i}: ${choice.id} Answer=${choice.description.und}|`;
                         
                            const arrayResponses = processStringToArray(s.result.correctResponsesPattern);
                            questionCorrectAnswers = '';
                            arrayResponses.forEach(cresp => {
                                questionCorrectAnswers += ` id=${cresp} Answer=${choice.description.und}|`;
                            });

                            const arrayUserResponses = processStringToArray(s.result.responses);
                            usersAnswer = '';
                            arrayUserResponses.forEach(cresp => {
                                usersAnswer += ` id=${cresp} Answer=${choice.description.und}|`;
                            });

                            i++;
                        });
                    }

                    return `${id},${actor},${verb},${objectId},${objectName},${duration},${questionAnswers},${questionPassed},${questionCorrectAnswers},${usersAnswer},${timestamp}`;
                }).join("\\n");

                mimeType = 'text/csv';
                extension = 'csv';
                break;
            case 'jsonl':
                data = statements.map(statement => JSON.stringify(statement)).join('\\n');
                mimeType = 'application/json';
                extension = 'jsonl';
                break;
            case 'raw':
                data = JSON.stringify(statements, null, 2);
                mimeType = 'application/json';
                extension = 'json';
                break;
            default:
                throw new Error('Invalid format selected.');
        }

        // Create a downloadable file
        const blob = new Blob([data], { type: mimeType });
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.setAttribute('hidden', '');
        a.setAttribute('href', url);
        a.setAttribute('download', `${getDomainFromUrl(endpoint)}_statements_${getCurrentTimestamp()}.${extension}`);
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        };
        // Function to format date to ISO 8601
const formatDateToISO8601 = (date) => {
    return new Date(date).toISOString().split('.')[0];
};

// Handle form submission
$('#queryForm').submit(async function(event) {
    event.preventDefault();
    isFetching = true;
    $('#loadingMessage').show();
    $('#alertMessage').html('');
    $('.progress').show();
    updateProgressBar(0, 0, $('#limit').val());
    disableForm(true);

    const endpoint = $('#endpoint').val();
    const client = $('#client').val();
    const secret = $('#secret').val();
    const dateSince = formatDateToISO8601($('#dateSince').val());
    const dateUntil = formatDateToISO8601($('#dateUntil').val());
    let limit = $('#limit').val();
    const format = $('#outputFormat').val();
    const search = $('#search').val().trim(); // Read the search field

    // Limit the maximum number of statements to fetch
    if (limit > 1000) {
        limit = 1000;
    }

    const auth = "Basic " + btoa(client + ":" + secret);
    const config = {
        endpoint: endpoint,
        auth: auth
    };

    try {
        // Test the connection to the LRS
        await testConnection(config);

        // Build the query parameters
        const query = ADL.XAPIWrapper.searchParams();
        query['since'] = dateSince;
        query['until'] = dateUntil;
        query['limit'] = limit;

        if (search) {
            query['activity'] = search; // Add search parameter if provided
        }

        // Fetch and process the statements
        const statements = await fetchStatements(config, query);
        processStatements(statements, format, endpoint);

        showMessage('Data successfully fetched and downloaded.', 'success');
    } catch (error) {
        console.error('An error occurred:', error);
        showMessage(`Error: ${error}`, 'danger');
    } finally {
        $('#loadingMessage').hide();
        $('.progress').hide();
        disableForm(false);
    }
});

// Handle stop button click to stop fetching statements
$('#stopButton').click(function() {
    isFetching = false;
});

});