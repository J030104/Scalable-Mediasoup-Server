export default class ButtonController {
    // Video off or on
    toggleVideo = () => {
        const videoElement = document.getElementById('localVideo');
        videoElement.srcObject.getVideoTracks()[0].enabled = !videoElement.srcObject.getVideoTracks()[0].enabled;
        // Update the button icon
        const videoButton = document.querySelector('.btn-video');
        const videoButtonImg = document.querySelector('.btn-video img');
        if (videoElement.srcObject.getVideoTracks()[0].enabled) {
            videoButton.classList.add('video-off'); // Add a class for video off state
            videoButton.classList.remove('video-on'); // Remove video on state
            videoButtonImg.src = "./src/assets/video-off.png";
        } else {
            videoButton.classList.add('video-on'); // Add a class for video on state
            videoButton.classList.remove('video-off'); // Remove video off state
            videoButtonImg.src = "./src/assets/video-on.png";
        }
    };

     // Mute or unmute the video
     toggleMute = () => {
        const videoElement = document.getElementById('localVideo');
        videoElement.srcObject.getAudioTracks()[0].enabled = !videoElement.srcObject.getAudioTracks()[0].enabled;
        // Update the button icon
        const muteButton = document.querySelector('.btn-audio');
        const muteButtonImg = document.querySelector('.btn-audio img');
        // Change background color dynamically
        if (videoElement.srcObject.getAudioTracks()[0].enabled) {
            muteButton.classList.add('unmuted'); // Add a class for unmuted state
            muteButton.classList.remove('muted'); // Remove muted state
            muteButtonImg.src = "./src/assets/mute.png";
        } else {
            muteButton.classList.add('muted'); // Add a class for muted state
            muteButton.classList.remove('unmuted'); // Remove unmuted state
            muteButtonImg.src = "./src/assets/unmute.png";
        }
    };

    // Invite others to the call
    invite = () => {
        console.log("Invite others to the call");
        const modal = document.getElementById('inviteModal');
        const inviteURLInput = document.getElementById('inviteURL');

        // Generate the invite URL from the current page
        inviteURLInput.value = window.location.href;
        modal.style.display = 'block';
    };

    // Leave the call
    leaveCall = () => {
        window.location.href = "/";
    };

    // Close the invite modal
    closeInviteModal = () => {
        const modal = document.getElementById('inviteModal');
        modal.style.display = 'none';
    }

    // Copy the invite URL to the clipboard
    copyInviteURL = () => {
        const inviteURL = document.getElementById('inviteURL');
        const notification = document.getElementById('copyNotification');
    
        inviteURL.select(); // Select the input content
        inviteURL.setSelectionRange(0, 99999); // For mobile compatibility
        navigator.clipboard.writeText(inviteURL.value)
            .then(() => {
                // Show notification
                notification.style.display = 'block';
                notification.style.opacity = '1';

                // Hide notification after 2 seconds
                setTimeout(() => {
                    notification.style.opacity = '0';
                    setTimeout(() => {
                        notification.style.display = 'none';
                    }, 300); // Delay to match transition
                }, 2000);
            })
            .catch((err) => {
                console.error('Failed to copy URL: ', err);
            });
    }

    
    addControlButtonEvent = () => {
        // Add event listener to the mute button
        const muteButton = document.querySelector('.btn-audio');
        if (muteButton) {
            muteButton.addEventListener('click', this.toggleMute);
        } 

        // Add event listener to the video button
        const videoButton = document.querySelector('.btn-video');
        if (videoButton) {
            videoButton.addEventListener('click', this.toggleVideo);
        } 

        // Add event listener to the invite button
        const inviteButton = document.querySelector('.btn-invite');
        if (inviteButton) {
            inviteButton.addEventListener('click', this.invite);
        } 

        // Add event listener to the leave call button
        const leaveCallButton = document.querySelector('.btn-leave');
        if (leaveCallButton) {
            leaveCallButton.addEventListener('click', this.leaveCall);
        } 

        // Close modal when clicking outside it
        window.onclick = function (event) {
            const modal = document.getElementById('inviteModal');
            if (event.target === modal) {
                modal.style.display = 'none';
            }
        };
    }
}
