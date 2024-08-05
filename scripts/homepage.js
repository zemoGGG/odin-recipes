document.addEventListener('DOMContentLoaded', function() {
    document.querySelectorAll('.card').forEach(card => {
        const popup = card.querySelector('.popup');

        if (!popup) {
            return;
        }
        
        function showPopup() {
            const items = popup.querySelectorAll('.dropdown_item');
            items.forEach((item, index) => {
                item.style.animationDelay = `${index * 60}ms`;
            });
            popup.classList.add('active');
            document.addEventListener('click', outsideClickListener);
            
        }

        function hidePopup() {
            if (popup) {
                popup.classList.remove('active');
                document.removeEventListener('click', outsideClickListener);
            }
        }

        function outsideClickListener(event) {
            if(!card.contains(event.target) && !popup.contains(event.target)) {
                hidePopup();
            }
        }
        
        card.addEventListener('mouseenter', showPopup);
        card.addEventListener('mouseleave', hidePopup);

        card.addEventListener('click', function(event) {
            event.stopPropagation();
            if(popup.classList.contains('active')) {
                hidePopup();
            } else {
                showPopup();
            }
        });

        popup.addEventListener('click', function(event) {
            event.stopPropagation();
        });
    });

    document.addEventListener('click', function() {
        document.querySelectorAll('.popup.active').forEach(popup => {
            popup.classList.remove('active');
        });
    });
});