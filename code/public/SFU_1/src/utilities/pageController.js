import state from '../state/state.js';

export default class PageController {
    columns = 1;
    rows = 1;
    maxColumns = 3;
    maxRows = 2;
    maxVideosPerPage = 1;
    currentPage = 0;
    totalPages = 1;

    constructor() {
        this.columns = 1;
        this.rows = 1;
        this.maxColumns = 3;
        this.maxRows = 2;
        this.maxVideosPerPage = 1;
        this.currentPage = 0;
        this.totalPages = 1;

        this.updateDerivedValues();
        this.updateVideoScaling();
        this.updateButtonVisibility();
    }

    // Update derived values when relevant properties are modified
    updateDerivedValues = () => {
        this.maxVideosPerPage = this.maxColumns * this.maxRows;
        const videoCount = document.getElementById("videoContainer").children.length;
        this.totalPages = Math.max(1, Math.ceil(videoCount / this.maxVideosPerPage));
    };

     // Update maxColumns based on window width
     updateMaxColumns = (width, videoWidth) => {
        this.maxColumns = Math.floor(width / videoWidth) || 1;
    }

    // Update maxRows based on window height
    updateMaxRows = (height, videoHeight) => {
        this.maxRows = Math.floor(height / videoHeight) || 1;
    }

    updateVideoScaling = () => {
        const root = document.documentElement;
        const remoteVideoContainer = document.getElementById("videoContainer");
        const remoteColumn = document.getElementById("remoteColumn");
        const videoCount = remoteVideoContainer.children.length;
        const gap = 10;

        // Get video panel dimensions
        const containerWidth = remoteColumn.clientWidth;
        const containerHeight = remoteColumn.clientHeight;
        // console.log(`Panel Width: ${containerWidth}, Panel Height: ${containerHeight}`);

        // // Calculate rows based on the number of videos and maxColumns
        this.rows = Math.min(Math.ceil(Math.sqrt(videoCount)), this.rows) || 1;
        this.columns =  Math.ceil(videoCount / this.rows) || 1;
        // console.log(`Columns: ${this.columns}, Rows: ${this.rows}`);

        let maxVideoWidth, maxVideoHeight, width, height;

        width = state.minVideoWidth;
        height = state.minVideoHeight;
        this.updateMaxColumns(containerWidth, width);
        this.updateMaxRows(containerHeight, height);
        this.updateDerivedValues();
        this.columns = Math.min(this.columns, this.maxColumns);
        this.rows = Math.min(Math.ceil(videoCount / this.columns), this.maxRows);

        // Dynamically adjust columns and rows to fit within the panel
        while (true) {
            // Calculate max video dimensions for current columns and rows
            maxVideoWidth = (containerWidth - (this.columns + 1) * gap) / this.columns;
            maxVideoHeight = (containerHeight - (this.rows + 1) * gap) / this.rows;

            // Enforce minimum constraints
            width = maxVideoWidth;
            height = width * 0.5625; // Maintaining 16:9 aspect ratio

            // Ensure that the height doesn't exceed the calculated maxVideoHeight
            if (height > maxVideoHeight) {
                height = maxVideoHeight;
                width = height * 1.7778; // Adjust width accordingly to maintain 16:9
            }

            // Check if the current grid fits within the panel
            if ((width <= maxVideoWidth && height <= maxVideoHeight)) {
                break; // Stop adjusting if the grid fits
            }

            // Adjust columns and rows to fit within the panel
            if (this.columns * maxVideoWidth > containerWidth) {
                this.columns -= 1;
            } else {
                this.columns += 1;
            }
            // Recalculate rows based on the new column count
            this.rows = Math.ceil(videoCount / this.columns);
        }

        // Update maxColumns and maxRows based on window size
        this.updateMaxColumns(containerWidth, width);
        this.updateMaxRows(containerHeight, height);
        this.updateDerivedValues();

        // Update CSS variables
        root.style.setProperty("--video-width", `${width}px`);
        root.style.setProperty("--video-height", `${height}px`);

        // Paginate videos
        const videos = Array.from(remoteVideoContainer.children); // Convert NodeList to Array
        videos.forEach((video, index) => {
            const startIndex = this.currentPage * this.maxVideosPerPage;
            const endIndex = startIndex + this.maxVideosPerPage;
        
            // Show videos for the current page, hide others
            if (index >= startIndex && index < endIndex) {
                video.style.display = 'block';
            } else {
                video.style.display = 'none';
            }
        });        

        // Update grid layout dynamically
        remoteVideoContainer.style.gridTemplateColumns = `repeat(${this.columns}, 1fr)`;
    };

    updateButtonVisibility = () => {
        const prevButton = document.querySelector('.pagingButton.previous');
        const nextButton = document.querySelector('.pagingButton.next');
        const remoteVideoContainer = document.getElementById("videoContainer");
    
        const videoCount = remoteVideoContainer.children.length;
    
        // Calculate the total number of pages
        this.totalPages = Math.ceil(videoCount / this.maxVideosPerPage);
    
        // Hide previous button if on first page
        prevButton.style.visibility = (this.currentPage || 0) > 0 ? "visible" : "hidden";
        
        // Hide next button if on last page
        nextButton.style.visibility = (this.currentPage || 0) < this.totalPages - 1 ? "visible" : "hidden";
    };

    // Handle page navigation
    goToPage = (goto) => {
        const remoteVideoContainer = document.getElementById("videoContainer");
        const videoCount = remoteVideoContainer.children.length;

        // Calculate the total number of pages
        const totalPages = Math.ceil(videoCount / this.maxVideosPerPage);

        // Ensure the new page is within valid bounds
        this.currentPage = Math.max(0, Math.min(this.currentPage + goto, totalPages - 1));

        // Update the paging controls visibility
        this.updateVideoScaling();
        this.updateButtonVisibility();
    };

    updateVideoContainer = () => {
        const remoteColumn = document.getElementById('remoteColumn');
        const videoPanel = document.getElementById('videoPanel');
        // Use getBoundingClientRect() for accurate dimensions
        const videoPanelHeight = videoPanel.getBoundingClientRect().height;

        // Dynamically update size based on window size
        remoteColumn.style.width = `${window.innerWidth}px`; 
        remoteColumn.style.height = `${videoPanelHeight}px`;
    }
}